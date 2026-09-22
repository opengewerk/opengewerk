import { randomUUID } from 'node:crypto'

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type DocumentId,
  eInvoiceGaps,
  formatFor,
  RuleError,
  shippedRules,
} from '@opengewerk/domain'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { accountsOf } from '../authentication/administration.js'
import { Database } from '../database/database.js'
import { customers, documents, memberships } from '../database/schema/index.js'
import { frozenContent } from '../documents/content.js'
import { isMailAddress } from '../mail/configuration.js'
import {
  type DocumentMailRow,
  messagesAbout,
  stillWaiting,
} from '../notifications/document-mail.js'
import { notify } from '../notifications/notify.js'
import type { DocumentAttachment } from '../notifications/templates.js'
import { RequiresPermission } from './authorization.js'
import { pick } from './body.js'
import { dutyOf } from './e-invoice.controller.js'
import { MAIL, type MailSettings } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** One message about a document, as the screen shows it. */
export interface DocumentMail {
  readonly id: string
  readonly to: string
  readonly attachment: DocumentAttachment | null
  readonly status: 'pending' | 'sent' | 'failed'
  readonly attempts: number
  readonly lastError: string | null
  readonly sentAt: string | null
  readonly createdAt: string
  /** The name of whoever asked, or null for a message nobody asked for. */
  readonly requestedBy: string | null
}

/**
 * A document sent to its customer by mail, the second half of #81.
 *
 * Sending is a wish the office states, and the route records it and nothing
 * more: it raises the notification, the notifications write the message, and
 * the job in `mail/` sends it when the mail server answers. The route never
 * talks to a mail server, which is what lets the button answer at once and a
 * message survive an afternoon without one.
 *
 * Under `document.issue`, not `document.write`. A technician writes the
 * report on site; what goes to a customer as the business's statement is the
 * office's to send, like the number is the office's to give.
 */
@Controller('documents/:documentId/mail')
export class DocumentMailController {
  constructor(
    private readonly database: Database,
    @Inject(MAIL) private readonly mail: MailSettings | null,
  ) {}

  @Get()
  @RequiresPermission('document.read')
  async list(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
  ): Promise<readonly DocumentMail[]> {
    const { rows, askers } = await this.database.forTenant(identity, async (tx) => {
      const found = await messagesAbout(tx, documentId as DocumentId)
      const asked = [...new Set(found.flatMap((row) => (row.requestedBy ? [row.requestedBy] : [])))]

      // The two steps the `auth_` tables ask for: the identifiers that work
      // here first, and only those looked up on the instance afterwards.
      const members =
        asked.length === 0
          ? []
          : await tx
              .select({ userId: memberships.userId })
              .from(memberships)
              .where(
                and(
                  eq(memberships.tenantId, identity.tenantId),
                  inArray(memberships.userId, asked),
                ),
              )

      return { rows: found, askers: members.map((member) => member.userId) }
    })

    const names = await accountsOf(this.database, askers, identity.userId)

    return rows.map((row) => shown(row, names))
  }

  @Post()
  @HttpCode(202)
  @RequiresPermission('document.issue')
  async send(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<DocumentMail> {
    if (this.mail === null) {
      throw new ServiceUnavailableException(
        'Für diese Instanz ist kein Mailserver eingerichtet, OpenGewerk verschickt deshalb keine ' +
          'E-Mails. Eingerichtet wird er in der .env mit SMTP_HOST und MAIL_FROM.',
      )
    }

    const { to } = pick(body ?? {}, ['to'])

    if (to !== undefined && typeof to !== 'string') {
      throw new UnprocessableEntityException('Die Adresse muss ein Text sein.')
    }

    const wish = await this.database.forTenant(identity, async (tx) => {
      const [document] = await tx
        .select({
          id: documents.id,
          number: documents.number,
          customerId: documents.customerId,
        })
        .from(documents)
        .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

      if (!document) {
        throw new NotFoundException()
      }

      if (document.number === null) {
        throw new ConflictException(
          'Verschickt wird ein festgeschriebener Beleg. Ein Entwurf hat noch keine Nummer, und ' +
            'was der Kunde bekommt, soll sich danach nicht mehr ändern.',
        )
      }

      const content = await frozenContent(tx, document.id)

      if (content === null) {
        throw new ConflictException(
          'Dieser Beleg wurde festgeschrieben, bevor OpenGewerk den Inhalt beim Festschreiben ' +
            'festhielt. Verschicken lässt er sich nur, wenn er dem damaligen Stand entspricht, und ' +
            'das kann OpenGewerk hier nicht zusagen.',
        )
      }

      const [customer] = await tx
        .select({ name: customers.name, email: customers.email })
        .from(customers)
        .where(eq(customers.id, document.customerId))

      const address = (to ?? customer?.email ?? '').trim()

      if (address === '') {
        throw new UnprocessableEntityException(
          'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt. Sie lässt sich beim Kunden ' +
            'eintragen oder hier für diese eine Nachricht angeben.',
        )
      }

      if (!isMailAddress(address)) {
        throw new UnprocessableEntityException(`"${address}" ist keine E-Mail-Adresse.`)
      }

      if (await stillWaiting(tx, document.id, address)) {
        throw new ConflictException(
          `Eine E-Mail mit diesem Beleg an ${address} wartet schon auf den Versand. Sobald sie ` +
            'hinaus ist oder aufgegeben wurde, lässt er sich noch einmal schicken.',
        )
      }

      return {
        documentId: document.id,
        address,
        name: customer?.name ?? null,
        attachment: await attachmentFor(tx, content),
      }
    })

    const [id] = await notify(
      this.database,
      identity.tenantId,
      {
        kind: 'document',
        documentId: wish.documentId,
        request: randomUUID(),
        to: { address: wish.address, name: wish.name },
        attachment: wish.attachment,
        requestedBy: identity.userId,
      },
      { origin: this.mail.origin },
    )

    const written = await this.database.forTenant(identity, async (tx) =>
      (await messagesAbout(tx, wish.documentId)).find((row) => row.id === id),
    )

    if (!written) {
      throw new ConflictException('Die Nachricht ließ sich nicht anlegen.')
    }

    const names = await accountsOf(this.database, [identity.userId], identity.userId)

    return shown(written, names)
  }
}

/**
 * Which file a document goes to its customer with.
 *
 * The one `formatFor` names, and for an e-invoice the ZUGFeRD PDF: it is the
 * e-invoice the standard asks for and a page a person can read, so it serves
 * a business whose software reads the data and one that prints the mail
 * alike. An e-invoice that lacks a value goes out as its PDF while the law
 * does not require it yet; once it does, sending it without is refused with
 * what is missing, because a PDF would then not be a proper invoice.
 */
async function attachmentFor(
  tx: Parameters<typeof dutyOf>[0],
  content: Parameters<typeof dutyOf>[1],
): Promise<DocumentAttachment> {
  try {
    if (formatFor(shippedRules, content).format !== 'e_invoice') {
      return 'pdf'
    }

    const gaps = eInvoiceGaps(content, 'en16931')

    if (gaps.length === 0) {
      return 'zugferd'
    }

    if ((await dutyOf(tx, content)).required) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message:
          'Diese Rechnung muss als E-Rechnung hinaus, und dafür fehlt noch etwas. ' +
          gaps.map((gap) => gap.message).join(' '),
        missing: gaps,
      })
    }

    return 'pdf'
  } catch (error) {
    if (error instanceof RuleError) {
      throw new UnprocessableEntityException(error.message)
    }

    throw error
  }
}

function shown(
  row: DocumentMailRow,
  names: ReadonlyMap<string, { readonly name: string }>,
): DocumentMail {
  return {
    id: row.id,
    to: row.to,
    attachment: row.attachment,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    requestedBy: row.requestedBy ? (names.get(row.requestedBy)?.name ?? null) : null,
  }
}
