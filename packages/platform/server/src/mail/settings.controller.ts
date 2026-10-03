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
  type Provider,
  Put,
  ServiceUnavailableException,
  type Type,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { SmtpSecurity } from '@opengewerk/platform-domain'

import { RequiresPermission } from '../api/authorization.js'
import { pick } from '../api/body.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database } from '../database/database.js'
import { checkMailServer, type MailServerCheck } from './check.js'
import type { MailConfiguration } from './configuration.js'
import { MAIL, type MailContext } from './context.js'
import type { MailServerInput, MailServers, MailServerView, MailStatus } from './server-settings.js'

/** The mail servers of the tenants, bound to the rules of the application, under which a module hands them in. */
export const MAIL_SERVERS = Symbol('MailServers')

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

/** The settings out of a body, typed; what they mean is checked by the mail servers. */
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
 * How often a tenant may try a mail server within ten minutes, saving
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

/** The rights the routes of the mail settings ask for, the application's. */
export interface MailSettingsRights<Right extends string> {
  /** Whether the tenant sends mail and from which address: for everybody who reads the settings. */
  readonly status: Right
  /** The mail server itself, its login and the signature. */
  readonly read: Right
  /** Setting it up, changing, checking and removing it. */
  readonly write: Right
}

/**
 * How a tenant sends mail, for the screen of its mail settings.
 *
 * Two kinds of reader. Everybody who reads the settings learns whether the
 * tenant sends mail and from which address, because a screen that offers to
 * send needs that to know whether sending will do anything. The mail server
 * itself, its login and the signature, is behind rights of their own: the
 * login to a mailbox is a way of writing in the tenant's name to anybody, and
 * the application gives them to whoever may do that.
 *
 * The password goes one way. It is taken, sealed and kept, and no route ever
 * hands it back; the screen learns whether there is one.
 *
 * Made by a function because the rights are the application's.
 */
function mailSettingsController(rights: MailSettingsRights<string>): Type<unknown> {
  @Controller('settings/mail')
  class MailSettingsController {
    /**
     * When each tenant last tried a mail server, the last ten minutes of it.
     * In memory: a restart hands back a fresh allowance, which is not worth a
     * table for a limit that only has to slow somebody down.
     */
    private readonly tries = new Map<string, number[]>()

    constructor(
      readonly database: Database,
      @Inject(MAIL) readonly mail: MailContext | null,
      @Inject(MAIL_SERVERS) readonly servers: MailServers,
    ) {}

    /** Counts one try at a mail server for the tenant, or refuses it. */
    private tryAllowed(identity: RequestIdentity): void {
      const now = Date.now()
      const recent = (this.tries.get(identity.tenantId) ?? []).filter(
        (at) => now - at < triesWithinMs,
      )

      if (recent.length >= triesAllowed) {
        // With a body shaped like Nest's own exceptions, so that a screen
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
    @RequiresPermission(rights.status)
    async status(@CurrentIdentity() identity: RequestIdentity): Promise<MailStatus> {
      return this.mail === null
        ? { configured: false, from: null }
        : this.servers.mailStatusOf(this.database, identity)
    }

    /** Wrapped, because a route that answers `null` sends no body at all, and a client reading JSON trips over that. */
    @Get('server')
    @RequiresPermission(rights.read)
    async server(
      @CurrentIdentity() identity: RequestIdentity,
    ): Promise<{ readonly server: MailServerView | null }> {
      return {
        server: await this.servers.readMailServer(this.database, identity, this.context().key),
      }
    }

    /**
     * Saves the settings, and asks the mail server first.
     *
     * A connection that is new, a server, a port or a login that was not
     * there before, is kept only when the server takes it: settings that
     * cannot send are not worth saving, and whoever saves them learns why now
     * rather than from the first message that never arrives. A connection
     * that is the one already kept is saved whatever the server says this
     * minute, with what it said, so that a new signature does not have to wait
     * for a server that is down.
     */
    @Put('server')
    @RequiresPermission(rights.write)
    async save(
      @CurrentIdentity() identity: RequestIdentity,
      @Body() body: unknown,
    ): Promise<SavedMailServer> {
      const context = this.context()
      const input = inputFrom(body)
      const configuration = await this.servers.configurationToTry(
        this.database,
        identity,
        context.key,
        input,
      )

      this.tryAllowed(identity)

      const check = await this.tryConnection(context, configuration)

      if (
        check.outcome !== 'ready' &&
        !(await this.servers.sameConnection(
          this.database,
          identity.tenantId,
          context.key,
          configuration,
        ))
      ) {
        throw new UnprocessableEntityException(`Nicht gespeichert. ${check.reason}`)
      }

      return {
        server: await this.servers.saveMailServer(this.database, identity, context.key, input),
        check,
      }
    }

    @Delete('server')
    @RequiresPermission(rights.write)
    async remove(@CurrentIdentity() identity: RequestIdentity): Promise<{ removed: true }> {
      this.context()
      await this.servers.removeMailServer(this.database, identity)

      return { removed: true }
    }

    /**
     * Tries the settings as they stand in the form, saved or not: connects,
     * signs in, sends nothing. The password is the one typed in, or the one
     * kept when none was.
     */
    @Post('server/check')
    @HttpCode(200)
    @RequiresPermission(rights.write)
    async check(
      @CurrentIdentity() identity: RequestIdentity,
      @Body() body: unknown,
    ): Promise<MailServerCheck> {
      const context = this.context()
      const configuration = await this.servers.configurationToTry(
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

  return MailSettingsController
}

/** What the routes of the mail settings are put together from. */
export interface MailSettingsParts<Right extends string> {
  /** The rights of the application, which have to hold the three named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  readonly rights: MailSettingsRights<Right>
  /** The mail servers of the tenants, bound to the rules of the application. */
  readonly servers: MailServers
}

/**
 * The routes of the mail settings and what they are handed, for the module of
 * an application. What a route needs to send, the context under `MAIL`, the
 * module provides itself: null on a closed instance, and the routes say so.
 */
export function mailSettingsParts<Right extends string>(
  parts: MailSettingsParts<Right>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  for (const right of [parts.rights.status, parts.rights.read, parts.rights.write]) {
    if (!parts.access.catalogue.isRight(right)) {
      throw new Error(`The catalogue lacks a right of the mail settings: ${right}`)
    }
  }

  return {
    controllers: [mailSettingsController(parts.rights)],
    providers: [{ provide: MAIL_SERVERS, useValue: parts.servers }],
  }
}
