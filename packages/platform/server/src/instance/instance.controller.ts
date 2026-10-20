import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
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
  InstanceMeasuresView,
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
import { claimReconfirmation } from '../authentication/reconfirmation.js'
import { Database } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { checkMailServer, type MailServerCheck } from '../mail/check.js'
import type { MailConfiguration } from '../mail/configuration.js'
import { MAIL, type MailContext } from '../mail/context.js'
import type { MailConnection } from '../mail/server-settings.js'
import { ACCOUNT_MESSAGES, type AccountMessages } from './account-mail.js'
import { operatorAccess } from './access.js'
import { checkedLegalTexts, readInstanceLegalTexts, saveLegalTexts } from './legal-texts.js'
import { checkedMeasures, readInstanceMeasures, saveMeasures } from './measures.js'
import { readInstanceLog } from './log.js'
import {
  instanceMailConfigurationToTry,
  instanceMailConnection,
  instanceMailServerInput,
  namedInstanceMailServer,
  readInstanceMailServer,
  removeInstanceMailServer,
  sameInstanceMailConnection,
  saveInstanceMailServer,
} from './mail-server.js'
import { type MailServerNamed, recordMailServerChange, tellWhoLeads } from './mail-server-notice.js'
import { appointOperator, listOperators, removeOperator } from './operators.js'
import { tellOperators } from './operators-notice.js'
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

/** Why a change of the mail server of the instance is refused to a session that did not confirm again. */
const mailServerUnconfirmed =
  'Der Mailserver der Instanz ändert sich erst nach der Bestätigung mit Passwort und Code.'

/** The same for naming somebody to run the instance, or taking them off (opengewerk-haustechnik#360). */
const operatorsUnconfirmed =
  'Wer die Instanz verwaltet, ändert sich erst nach der Bestätigung mit Passwort und Code.'

/** The same for a tenant made for somebody else, and the link that makes them lead it. */
const tenantUnconfirmed =
  'Ein neuer Mandant mit Einladung entsteht erst nach der Bestätigung mit Passwort und Code.'

/**
 * The area of the instance (#188), for whoever runs it: the tenants on it
 * (#142), its settings, its legal texts, the accounts that run it and its log. Not the
 * workplace of any tenant; every route but the first asks for somebody who
 * runs the instance and has a second factor, and nothing here shows what is
 * in a tenant beyond its name, the day it came, who leads it and how many
 * work there.
 *
 * One setting reaches into every tenant all the same, the mail server of the
 * instance: the link to a new password goes out through it, and whoever sets
 * it up could read the links there (opengewerk-haustechnik#360). So it changes
 * only after confirming again with the password and the code from the app,
 * and every change goes into the log of every tenant and by mail, through the
 * server of before, to whoever leads one (`mail-server-notice.ts`). Whoever
 * runs the instance writes those rows and reads none of them.
 *
 * Naming somebody to run the instance, or taking them off, and a tenant made
 * for somebody else take the same confirmation: whoever is named could change
 * the mail server next, with a confirmation of their own, and a session left
 * open must not be enough for that either. A change of who runs it is told by
 * mail to each of them (`operators-notice.ts`).
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
    @Optional()
    @Inject(ACCOUNT_MESSAGES)
    private readonly messages?: AccountMessages | null,
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

  /**
   * Takes the confirmation of the session for one change of the mail server,
   * or refuses it. Spent before anything is asked of a server or saved, so a
   * change that fails after it needs the password again, which is the side to
   * err on, and a session that did not confirm reaches nothing at all.
   */
  private async reconfirmed(user: SignedInUser, refusal = mailServerUnconfirmed): Promise<void> {
    if (!(await claimReconfirmation(this.database, user.sessionId))) {
      throw new ForbiddenException(refusal)
    }
  }

  /** Tells everybody who runs the instance of a change among them, without waiting for the mail. */
  private tellOperators(
    change: { readonly appointed: boolean; readonly name: string; readonly email: string },
    userId: string,
  ): void {
    if (!this.mail || !this.messages) {
      return
    }

    void tellOperators(this.database, this.mail, this.messages, change, userId).catch(
      (error: unknown) => {
        console.error('Die Nachricht über die Verwaltung der Instanz ging nicht hinaus.', error)
      },
    )
  }

  /**
   * Tells whoever leads a tenant of the change, through the connection of
   * before. Not awaited: the answer does not wait for one mail per person, and
   * a server of before that is down this minute would otherwise hold the
   * change up. The log of every tenant has it already.
   */
  private tellWhoLeads(
    previous: MailConnection | null,
    after: MailServerNamed | null,
    userId: string,
  ): void {
    if (!this.mail || !this.messages) {
      return
    }

    void tellWhoLeads(this.database, this.mail, this.messages, previous, after, userId).catch(
      (error: unknown) => {
        console.error(
          'Die Nachricht über den geänderten Mailserver der Instanz ging nicht hinaus.',
          error,
        )
      },
    )
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
   *
   * Only after confirming again (opengewerk-haustechnik#360), and a change is
   * written into every tenant before it is saved and told to whoever leads
   * one after: see the class. Saving the connection there is, from the same
   * address, changes nothing and tells nobody.
   */
  @Put('mail-server')
  @RequiresOperator()
  async saveMailServer(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<SavedInstanceMailServer> {
    const context = this.mailContext()

    await this.reconfirmed(user)

    const input = instanceMailServerInput(body)
    const configuration = await instanceMailConfigurationToTry(this.database, context.key, input)

    this.mailTryAllowed()

    const check = await this.tryMailServer(context, configuration)
    const same = await sameInstanceMailConnection(this.database, context.key, configuration)

    if (check.outcome !== 'ready' && !same) {
      throw new UnprocessableEntityException(`Nicht gespeichert. ${check.reason}`)
    }

    // What there was, read before anything changes: the server the tenants
    // are told through, and what they are told it was.
    const previous = await instanceMailConnection(this.database, context.key)
    const before = await namedInstanceMailServer(this.database)
    const after = { host: configuration.host, fromAddress: configuration.from }
    const changed = !same || before?.fromAddress !== after.fromAddress

    if (changed) {
      await recordMailServerChange(this.database, user.userId, before, after)
    }

    const server = await saveInstanceMailServer(this.database, user.userId, context.key, input)

    if (changed) {
      this.tellWhoLeads(previous, after, user.userId)
    }

    return { server, check }
  }

  /**
   * Removes the mail server of the instance, after confirming again, written
   * into every tenant first and told to whoever leads one through the server
   * that goes, as a change is.
   */
  @Delete('mail-server')
  @RequiresOperator()
  async removeMailServer(@CurrentUser() user: SignedInUser): Promise<{ readonly removed: true }> {
    await this.reconfirmed(user)

    const before = await namedInstanceMailServer(this.database)

    if (!before) {
      throw new NotFoundException('Die Instanz hat keinen Mailserver, der sich entfernen ließe.')
    }

    const previous = this.mail ? await instanceMailConnection(this.database, this.mail.key) : null

    await recordMailServerChange(this.database, user.userId, before, null)
    await removeInstanceMailServer(this.database, user.userId)
    this.tellWhoLeads(previous, null, user.userId)

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

  /**
   * Part B of the technical and organisational measures and the
   * subprocessors (opengewerk-haustechnik#358) for their screen, with when
   * and by whom they were last changed. A tenant reads them only inside its
   * own documents, which the application makes.
   */
  @Get('measures')
  @RequiresOperator()
  measures(@CurrentUser() user: SignedInUser): Promise<InstanceMeasuresView> {
    return readInstanceMeasures(this.database, user.userId)
  }

  /** Keeps part B and annex 2 whole: what the screen shows is what the request sends. */
  @Put('measures')
  @RequiresOperator()
  changeMeasures(
    @CurrentUser() user: SignedInUser,
    @Body() body: unknown,
  ): Promise<InstanceMeasuresView> {
    return saveMeasures(this.database, user.userId, checkedMeasures(body))
  }

  @Get('operators')
  @RequiresOperator()
  operators(@CurrentUser() user: SignedInUser): Promise<OperatorView[]> {
    return listOperators(this.database, user.userId)
  }

  /** Names an account to run the instance, after confirming again, and tells everybody who runs it. */
  @Post('operators')
  @RequiresOperator()
  async appoint(@CurrentUser() user: SignedInUser, @Body() body: unknown): Promise<OperatorView> {
    const email = field(body, 'email')

    if (typeof email !== 'string') {
      throw new BadRequestException('Die E-Mail-Adresse fehlt.')
    }

    await this.reconfirmed(user, operatorsUnconfirmed)

    const appointed = await appointOperator(
      this.database,
      this.access.sentences.instance,
      user.userId,
      email,
    )

    this.tellOperators(
      { appointed: true, name: appointed.name, email: appointed.email },
      user.userId,
    )

    return appointed
  }

  /** Takes an account off, after confirming again, and tells it and everybody who still runs the instance. */
  @Delete('operators/:userId')
  @RequiresOperator()
  async remove(
    @CurrentUser() user: SignedInUser,
    @Param('userId') userId: string,
  ): Promise<{ readonly removed: string }> {
    await this.reconfirmed(user, operatorsUnconfirmed)

    const leaving = (await listOperators(this.database, user.userId)).find(
      (operator) => operator.userId === userId,
    )

    await removeOperator(this.database, this.access.sentences.instance, user.userId, userId)

    if (leaving) {
      this.tellOperators(
        { appointed: false, name: leaving.name, email: leaving.email },
        user.userId,
      )
    }

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
    await this.reconfirmed(user, tenantUnconfirmed)

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
