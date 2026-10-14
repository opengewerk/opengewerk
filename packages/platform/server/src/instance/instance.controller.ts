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
  Optional,
  Param,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type {
  InstanceAccess,
  InstanceLegalTextsView,
  InstanceLogPage,
  InstanceMailServerState,
  InstanceMailServerView,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
} from '@opengewerk/platform-domain'

import { RequiresOperator, RequiresSession } from '../api/authorization.js'
import { CurrentUser, type SignedInUser } from '../api/identity.js'
import { ACCESS_RULES, type AccessRules } from '../authentication/access.js'
import { Database } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { checkMailServer, type MailServerCheck } from '../mail/check.js'
import type { MailConfiguration } from '../mail/configuration.js'
import { MAIL, type MailContext } from '../mail/context.js'
import { operatorAccess } from './access.js'
import { checkedLegalTexts, readInstanceLegalTexts, saveLegalTexts } from './legal-texts.js'
import { readInstanceLog } from './log.js'
import {
  instanceMailConfigurationToTry,
  instanceMailServerInput,
  readInstanceMailServer,
  removeInstanceMailServer,
  sameInstanceMailConnection,
  saveInstanceMailServer,
} from './mail-server.js'
import { appointOperator, listOperators, removeOperator } from './operators.js'
import {
  checkedChange,
  type InstanceSettingsCache,
  readInstanceSettings,
  saveInstanceSettings,
} from './settings.js'
import { createTenantFor, listInstanceTenants } from './tenants.js'

/**
 * The settings of the instance in memory, handed in by an application that
 * keeps them there: a change made in the area then reaches whatever reads
 * them on the next request, and not on the next refresh.
 */
export const INSTANCE_SETTINGS = Symbol('InstanceSettings')

/**
 * How often the mail server of the instance may be tried within ten minutes,
 * saving included, by everybody who runs the instance together: plenty for
 * going through the settings of a provider, too few to try one password
 * after the other against somebody else's mail server with this instance
 * doing the connecting.
 */
const mailTriesAllowed = 30
const mailTriesWithinMs = 10 * 60_000

/** What saving the mail server of the instance answers: the settings as kept, and what the server said to them. */
export interface SavedInstanceMailServer {
  readonly server: InstanceMailServerView
  readonly check: MailServerCheck
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined
}

/**
 * The area of the instance (#188), for whoever runs it: the tenants on it
 * (#142), its settings, its legal texts, the accounts that run it and its log. Not the
 * workplace of any tenant; every route but the first asks for somebody who
 * runs the instance and has a second factor, and nothing here reads what is
 * in a tenant.
 */
@Controller('instance')
export class InstanceController {
  constructor(
    private readonly database: Database,
    @Inject(ACCESS_RULES) private readonly access: AccessRules,
    @Optional()
    @Inject(INSTANCE_SETTINGS)
    private readonly settingsInMemory?: InstanceSettingsCache | null,
    @Optional()
    @Inject(MAIL)
    private readonly mail?: MailContext | null,
  ) {}

  /** When the mail server of the instance was last tried, the last ten minutes of it. In memory, like the tries of a tenant. */
  private mailTries: number[] = []

  /** What mail needs, or the sentence that says this instance sends none. */
  private mailContext(): MailContext {
    if (!this.mail) {
      throw new ServiceUnavailableException(
        'Diese Instanz verschickt keine E-Mails, sie ist geschlossen oder ohne Versand gestartet.',
      )
    }

    return this.mail
  }

  /** Counts one try at the mail server of the instance, or refuses it. */
  private mailTryAllowed(): void {
    const now = Date.now()
    const recent = this.mailTries.filter((at) => now - at < mailTriesWithinMs)

    if (recent.length >= mailTriesAllowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            `Der Mailserver wurde in den letzten zehn Minuten ${String(mailTriesAllowed)}-mal ` +
            'geprüft. In ein paar Minuten geht es wieder.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    recent.push(now)
    this.mailTries = recent
  }

  private async tryMailServer(
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

  /** Whether the person asking may enter, for the entry in the menu under the name. */
  @Get('access')
  @RequiresSession()
  entry(@CurrentUser() user: SignedInUser): Promise<InstanceAccess> {
    return operatorAccess(this.database, user.userId, user.sessionId)
  }

  @Get('settings')
  @RequiresOperator()
  settings(): Promise<InstanceSettingsView> {
    return readInstanceSettings(this.database)
  }

  @Put('settings')
  @RequiresOperator()
  async saveSettings(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<InstanceSettingsView> {
    const saved = await saveInstanceSettings(this.database, user.userId, checkedChange(body))

    // At once for the mail server a tenant is checking right now, not in half a minute.
    await this.settingsInMemory?.refresh()

    return saved
  }

  /**
   * The mail server of the instance (opengewerk-haustechnik#81), without its
   * password, and whether this instance sends mail at all.
   */
  @Get('mail-server')
  @RequiresOperator()
  async mailServer(): Promise<InstanceMailServerState> {
    return this.mail
      ? { sends: true, server: await readInstanceMailServer(this.database, this.mail.key) }
      : { sends: false, server: null }
  }

  /**
   * Saves the mail server of the instance, and asks it first. A connection
   * that is new is kept only when the server takes it; the one already kept
   * is saved whatever the server says this minute, with what it said.
   */
  @Put('mail-server')
  @RequiresOperator()
  async saveMailServer(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<SavedInstanceMailServer> {
    const context = this.mailContext()
    const input = instanceMailServerInput(body)
    const configuration = await instanceMailConfigurationToTry(this.database, context.key, input)

    this.mailTryAllowed()

    const check = await this.tryMailServer(context, configuration)

    if (
      check.outcome !== 'ready' &&
      !(await sameInstanceMailConnection(this.database, context.key, configuration))
    ) {
      throw new UnprocessableEntityException(`Nicht gespeichert. ${check.reason}`)
    }

    return {
      server: await saveInstanceMailServer(this.database, user.userId, context.key, input),
      check,
    }
  }

  @Delete('mail-server')
  @RequiresOperator()
  async removeMailServer(@CurrentUser() user: SignedInUser): Promise<{ readonly removed: true }> {
    await removeInstanceMailServer(this.database, user.userId)

    return { removed: true }
  }

  /**
   * Tries the settings as they stand in the form, saved or not: connects,
   * signs in, sends nothing. The password is the one typed in, or the one
   * kept when none was.
   */
  @Post('mail-server/check')
  @HttpCode(200)
  @RequiresOperator()
  async tryTheMailServer(@Body() body: unknown): Promise<MailServerCheck> {
    const context = this.mailContext()
    const configuration = await instanceMailConfigurationToTry(
      this.database,
      context.key,
      instanceMailServerInput(body),
    )

    this.mailTryAllowed()

    return this.tryMailServer(context, configuration)
  }

  /**
   * The legal texts of the instance (opengewerk-haustechnik#129) for their
   * screen, each with when and by whom it was last changed. Anybody reads the
   * texts themselves on the route of their own, `/legal-texts`.
   */
  @Get('legal-texts')
  @RequiresOperator()
  legalTexts(@CurrentUser() user: SignedInUser): Promise<InstanceLegalTextsView> {
    return readInstanceLegalTexts(this.database, user.userId)
  }

  @Put('legal-texts')
  @RequiresOperator()
  changeLegalTexts(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<InstanceLegalTextsView> {
    return saveLegalTexts(this.database, user.userId, checkedLegalTexts(body))
  }

  @Get('operators')
  @RequiresOperator()
  operators(@CurrentUser() user: SignedInUser): Promise<OperatorView[]> {
    return listOperators(this.database, user.userId)
  }

  @Post('operators')
  @RequiresOperator()
  appoint(@CurrentUser() user: SignedInUser, @Body() body: unknown): Promise<OperatorView> {
    const email = field(body, 'email')

    if (typeof email !== 'string') {
      throw new BadRequestException('Die E-Mail-Adresse fehlt.')
    }

    return appointOperator(this.database, this.access.sentences.instance, user.userId, email)
  }

  @Delete('operators/:userId')
  @RequiresOperator()
  async remove(
    @CurrentUser() user: SignedInUser,
    @Param('userId') userId: string,
  ): Promise<{ readonly removed: string }> {
    await removeOperator(this.database, this.access.sentences.instance, user.userId, userId)

    return { removed: userId }
  }

  @Get('log')
  @RequiresOperator()
  log(
    @CurrentUser() user: SignedInUser,
    @Query('before') before: unknown,
  ): Promise<InstanceLogPage> {
    if (before !== undefined && (typeof before !== 'string' || !isUuid(before))) {
      throw new BadRequestException('before ist die Kennung eines Eintrags.')
    }

    return readInstanceLog(this.database, user.userId, typeof before === 'string' ? before : null)
  }

  @Get('tenants')
  @RequiresOperator()
  tenants(@CurrentUser() user: SignedInUser): Promise<InstanceTenantView[]> {
    return listInstanceTenants(this.database, user.userId)
  }

  /**
   * A tenant for somebody else (#142): the tenant and an invitation to lead
   * it. The link is in this answer and nowhere else, as when somebody is
   * invited into a tenant.
   */
  @Post('tenants')
  @RequiresOperator()
  async createFor(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<{ readonly tenantId: string; readonly token: string; readonly expiresAt: string }> {
    const created = await createTenantFor(this.database, this.access, user.userId, {
      name: field(body, 'name'),
      leadName: field(body, 'leadName'),
      leadEmail: field(body, 'leadEmail'),
    })

    return {
      tenantId: created.tenantId,
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
    }
  }
}
