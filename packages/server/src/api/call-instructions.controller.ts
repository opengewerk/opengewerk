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
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { InstructionSheet, JobId } from '@opengewerk/domain'
import { accountsOf, Database, isMailAddress, MAIL, type MailContext, pick } from '@opengewerk/platform-server'
import { asc, and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { earlyStartRequests } from '../database/schema/index.js'
import { requireMailServer } from '../mail/server-settings.js'
import { type CallMailRow, callMailWaiting, messagesAboutCall } from '../notifications/call-mail.js'
import { notify } from '../notifications/occasions.js'
import {
  callInstructions,
  CallInstructionsRefused,
  callOf,
  callPrintFacts,
} from '../service-calls/instructions.js'
import { todayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { DocumentFiles } from './document-files.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** A message with the instructions of a call, as the office lists it. */
export interface CallMail {
  readonly id: string
  readonly to: string
  readonly status: 'pending' | 'sent' | 'failed'
  readonly lastError: string | null
  readonly sentAt: string | null
  readonly createdAt: string
  /** The name of whoever asked, or null for one sent after a signature at the door. */
  readonly requestedBy: string | null
  readonly withRequest: boolean
}

/** The instructions of a service call as the device and the office show them. */
export interface CallInstructionsView {
  /** Why the job gets none, or null when it does. */
  readonly refusal: string | null
  readonly urgentRepair: boolean
  /** The customer's address for mail, or null when there is none. */
  readonly email: string | null
  readonly sheets: readonly InstructionSheet[]
  readonly request: string | null
  readonly gaps: readonly string[]
  readonly fingerprint: string
  readonly signed: readonly {
    readonly id: string
    readonly signerName: string
    readonly signedAt: string
  }[]
  readonly mails: readonly CallMail[]
}

function shown(row: CallMailRow, names: ReadonlyMap<string, { readonly name: string }>): CallMail {
  return {
    id: row.id,
    to: row.to,
    status: row.status,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    requestedBy: row.requestedBy ? (names.get(row.requestedBy)?.name ?? null) : null,
    withRequest: row.earlyStartRequestId !== null,
  }
}

/**
 * The instructions of a service call (#292, Feature-Gliederung 4.1): what a
 * consumer gets without a quote. The device shows them at the door and the
 * customer signs the request for an early start there, which travels through
 * the sync and goes to the customer with the instructions by mail. The office
 * sends them by mail for a call taken on the phone, and prints them.
 *
 * Reading under `job.read`, which the technician on the job has; sending
 * under `job.write`, which is the office's, like the call itself.
 */
@Controller('jobs/:jobId/instructions')
export class CallInstructionsController {
  constructor(
    private readonly database: Database,
    private readonly files: DocumentFiles,
    @Inject(MAIL) private readonly mail: MailContext | null,
  ) {}

  @Get()
  @RequiresPermission('job.read')
  async show(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('jobId') jobId: string,
  ): Promise<CallInstructionsView> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const call = await callOf(tx, jobId as JobId)

      if (!call) {
        throw new NotFoundException()
      }

      const held = await callInstructions(tx, call, todayInGermany())
      const signed = await tx
        .select({
          id: earlyStartRequests.id,
          signerName: earlyStartRequests.signerName,
          signedAt: earlyStartRequests.signedAt,
        })
        .from(earlyStartRequests)
        .where(and(eq(earlyStartRequests.jobId, call.id), isNull(earlyStartRequests.deletedAt)))
        .orderBy(asc(earlyStartRequests.signedAt))

      return { held, signed, mails: await messagesAboutCall(tx, call.id) }
    })

    const askers = [...new Set(found.mails.flatMap((row) => (row.requestedBy ? [row.requestedBy] : [])))]
    const names = await accountsOf(this.database, askers, identity.userId)

    return {
      refusal: found.held.refusal,
      urgentRepair: found.held.call.urgentRepair,
      email: found.held.call.customerEmail,
      sheets: found.held.sheets,
      request: found.held.request,
      gaps: found.held.gaps,
      fingerprint: found.held.fingerprint,
      signed: found.signed.map((row) => ({
        id: row.id,
        signerName: row.signerName,
        signedAt: row.signedAt.toISOString(),
      })),
      mails: found.mails.map((row) => shown(row, names)),
    }
  }

  /**
   * The instructions as one PDF, to print and hand over or post: with the
   * request signed at the door when one is named, otherwise with the sheet to
   * fill in on paper.
   */
  @Get('pdf')
  @RequiresPermission('job.read')
  async pdf(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('jobId') jobId: string,
    @Query('request') request: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const facts = await this.database
      .forTenant(identity, (tx) =>
        callPrintFacts(
          tx,
          jobId as JobId,
          typeof request === 'string' && request !== '' ? request : null,
          todayInGermany(),
        ),
      )
      .catch((error: unknown) => {
        throw error instanceof CallInstructionsRefused
          ? new UnprocessableEntityException(error.message)
          : error
      })

    const bytes = await this.files.printCallInstructions(facts, identity)
    const name = `Belehrungen zu ${facts.call.number ?? facts.call.designation}.pdf`.replace(
      /[\\/:*?"<>|]/g,
      '-',
    )

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="Belehrungen.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      length: bytes.byteLength,
    })
  }

  /**
   * The instructions by mail, for a call taken on the phone. A wish the route
   * records, as for a document: the notifications write the message and the
   * job sends it. To the customer's address, or to one given for this one
   * message.
   */
  @Post('mail')
  @HttpCode(202)
  @RequiresPermission('job.write')
  async send(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ): Promise<CallMail> {
    if (this.mail === null) {
      throw new ServiceUnavailableException(
        'Diese Instanz verschickt keine E-Mails, sie ist geschlossen oder ohne Versand gestartet.',
      )
    }

    await requireMailServer(this.database, identity)

    const { to } = pick(body ?? {}, ['to'])

    if (to !== undefined && typeof to !== 'string') {
      throw new UnprocessableEntityException('Die Adresse muss ein Text sein.')
    }

    const wish = await this.database.forTenant(identity, async (tx) => {
      const call = await callOf(tx, jobId as JobId)

      if (!call) {
        throw new NotFoundException()
      }

      const held = await callInstructions(tx, call, todayInGermany())

      if (held.refusal !== null) {
        throw new UnprocessableEntityException(held.refusal)
      }

      if (held.gaps.length > 0) {
        throw new UnprocessableEntityException(held.gaps.join(' '))
      }

      const address = (to ?? call.customerEmail ?? '').trim()

      if (address === '') {
        throw new UnprocessableEntityException(
          'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt. Sie lässt sich beim Kunden ' +
            'eintragen oder hier für diese eine Nachricht angeben; sonst die Belehrungen ausdrucken.',
        )
      }

      if (!isMailAddress(address)) {
        throw new UnprocessableEntityException(`"${address}" ist keine E-Mail-Adresse.`)
      }

      if (await callMailWaiting(tx, call.id, address)) {
        throw new ConflictException(
          `Eine E-Mail mit den Belehrungen an ${address} wartet schon auf den Versand. Sobald sie ` +
            'hinaus ist oder aufgegeben wurde, lassen sie sich noch einmal schicken.',
        )
      }

      return { jobId: call.id, address, name: call.customerName }
    })

    const [id] = await notify(
      this.database,
      identity.tenantId,
      {
        kind: 'job_instructions',
        jobId: wish.jobId,
        request: randomUUID(),
        to: { address: wish.address, name: wish.name },
        requestedBy: identity.userId,
      },
      { origin: this.mail.origin },
    )

    const written = await this.database.forTenant(identity, async (tx) =>
      (await messagesAboutCall(tx, wish.jobId)).find((row) => row.id === id),
    )

    if (!written) {
      throw new ConflictException('Die Nachricht ließ sich nicht anlegen.')
    }

    return shown(written, await accountsOf(this.database, [identity.userId], identity.userId))
  }
}
