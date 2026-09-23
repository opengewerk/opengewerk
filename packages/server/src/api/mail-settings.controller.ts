import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Put,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { type SmtpSecurity } from '@opengewerk/domain'

import { Database } from '../database/database.js'
import { checkMailServer, type MailServerCheck } from '../mail/check.js'
import type { MailConfiguration } from '../mail/configuration.js'
import {
  configurationToTry,
  type MailServerInput,
  type MailServerView,
  type MailStatus,
  mailStatusOf,
  readMailServer,
  removeMailServer,
  sameConnection,
  saveMailServer,
} from '../mail/server-settings.js'
import { RequiresPermission } from './authorization.js'
import { pick } from './body.js'
import { MAIL, type MailContext } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** A field that is text or nothing, and nothing when it is empty. */
function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} ist kein Text.`)
  }

  return value.trim() === '' ? null : value
}

/** The settings out of a body, typed; what they mean is checked in `mail/`. */
function inputFrom(body: unknown): MailServerInput {
  const values = pick(body ?? {}, [
    'host',
    'port',
    'security',
    'username',
    'password',
    'fromAddress',
    'signature',
  ] as const)

  if (values.port !== undefined && values.port !== null && typeof values.port !== 'number') {
    throw new BadRequestException('Der Port ist eine Zahl.')
  }

  if (values.password !== undefined && typeof values.password !== 'string') {
    throw new BadRequestException('Das Passwort ist ein Text.')
  }

  return {
    host: optionalText(values.host, 'Der Server') ?? '',
    port: typeof values.port === 'number' ? values.port : null,
    security: (typeof values.security === 'string' ? values.security : 'starttls') as SmtpSecurity,
    username: optionalText(values.username, 'Der Benutzername'),
    ...(values.password === undefined ? {} : { password: values.password }),
    fromAddress: optionalText(values.fromAddress, 'Die Absenderadresse') ?? '',
    signature: optionalText(values.signature, 'Die Signatur'),
  }
}

/**
 * How often a business may try a mail server within ten minutes, saving
 * included. Plenty for somebody going through the settings of a provider
 * field by field; too few to try one password after the other against
 * somebody else's mail server, with this instance doing the connecting
 * (GHSA-5664-h6fc-v729).
 */
const triesAllowed = 30
const triesWithinMs = 10 * 60_000

/** What saving answers: the settings as kept, and what the mail server said to them. */
export interface SavedMailServer {
  readonly server: MailServerView
  readonly check: MailServerCheck
}

/**
 * How this business sends mail, for the screen "E-Mail-Einstellungen" in the office.
 *
 * Two kinds of reader. Everybody who reads the settings learns whether the
 * business sends mail and from which address, because the office needs that
 * to know whether "Per E-Mail" will do anything. The mail server itself, its
 * login and the signature, is behind `mail.read` and `mail.write`, which only
 * the owner has: the login to a mailbox is a way of writing in the business's
 * name to anybody.
 *
 * The password goes one way. It is taken, sealed and kept, and no route ever
 * hands it back; the screen learns whether there is one.
 */
@Controller('settings/mail')
export class MailSettingsController {
  /**
   * When each business last tried a mail server, the last ten minutes of it.
   * In memory: a restart hands back a fresh allowance, which is not worth a
   * table for a limit that only has to slow somebody down.
   */
  private readonly tries = new Map<string, number[]>()

  constructor(
    private readonly database: Database,
    @Inject(MAIL) private readonly mail: MailContext | null,
  ) {}

  /** Counts one try at a mail server for the business, or refuses it. */
  private tryAllowed(identity: RequestIdentity): void {
    const now = Date.now()
    const recent = (this.tries.get(identity.tenantId) ?? []).filter(
      (at) => now - at < triesWithinMs,
    )

    if (recent.length >= triesAllowed) {
      // With a body shaped like Nest's own exceptions, so that the office
      // reads the sentence from `message` as it does everywhere else.
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            `Der Mailserver wurde in den letzten zehn Minuten ${String(triesAllowed)}-mal ` +
            'geprüft. In ein paar Minuten geht es wieder.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    recent.push(now)
    this.tries.set(identity.tenantId, recent)
  }

  private context(): MailContext {
    if (this.mail === null) {
      throw new ServiceUnavailableException(
        'Diese Instanz verschickt keine E-Mails, sie ist geschlossen oder ohne Versand gestartet.',
      )
    }

    return this.mail
  }

  @Get()
  @RequiresPermission('settings.read')
  async status(@CurrentIdentity() identity: RequestIdentity): Promise<MailStatus> {
    return this.mail === null
      ? { configured: false, from: null }
      : mailStatusOf(this.database, identity)
  }

  /** Wrapped, because a route that answers `null` sends no body at all, and a client reading JSON trips over that. */
  @Get('server')
  @RequiresPermission('mail.read')
  async server(
    @CurrentIdentity() identity: RequestIdentity,
  ): Promise<{ readonly server: MailServerView | null }> {
    return { server: await readMailServer(this.database, identity, this.context().key) }
  }

  /**
   * Saves the settings, and asks the mail server first.
   *
   * A connection that is new, a server, a port or a login that was not there
   * before, is kept only when the server takes it: settings that cannot send
   * are not worth saving, and the owner learns why now rather than from the
   * first invoice that never arrives. A connection that is the one already
   * kept is saved whatever the server says this minute, with what it said,
   * so that a new signature does not have to wait for a server that is down.
   */
  @Put('server')
  @RequiresPermission('mail.write')
  async save(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<SavedMailServer> {
    const context = this.context()
    const input = inputFrom(body)
    const configuration = await configurationToTry(this.database, identity, context.key, input)

    this.tryAllowed(identity)

    const check = await this.tryConnection(context, configuration)

    if (
      check.outcome !== 'ready' &&
      !(await sameConnection(this.database, identity.tenantId, context.key, configuration))
    ) {
      throw new UnprocessableEntityException(`Nicht gespeichert. ${check.reason}`)
    }

    return { server: await saveMailServer(this.database, identity, context.key, input), check }
  }

  @Delete('server')
  @RequiresPermission('mail.write')
  async remove(@CurrentIdentity() identity: RequestIdentity): Promise<{ removed: true }> {
    this.context()
    await removeMailServer(this.database, identity)

    return { removed: true }
  }

  /**
   * Tries the settings as they stand in the form, saved or not: connects,
   * signs in, sends nothing. The password is the one typed in, or the one
   * kept when none was.
   */
  @Post('server/check')
  @HttpCode(200)
  @RequiresPermission('mail.write')
  async check(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<MailServerCheck> {
    const context = this.context()
    const configuration = await configurationToTry(
      this.database,
      identity,
      context.key,
      inputFrom(body),
    )

    this.tryAllowed(identity)

    return this.tryConnection(context, configuration)
  }

  private async tryConnection(
    context: MailContext,
    configuration: MailConfiguration,
  ): Promise<MailServerCheck> {
    const transport = context.connect(configuration)

    try {
      return await checkMailServer(transport, configuration)
    } finally {
      transport.close()
    }
  }
}
