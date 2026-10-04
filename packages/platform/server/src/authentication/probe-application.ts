import 'reflect-metadata'

import { rmSync } from 'node:fs'

import {
  Controller,
  type DynamicModule,
  Get,
  type INestApplication,
  Module,
  Post,
} from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import {
  accessRights,
  type MemberIdentity,
  rightsCatalogue,
  type RoleDefinition,
  type TenantChoice,
  type TenantId,
} from '@opengewerk/platform-domain'
import { toNodeHandler } from 'better-auth/node'
import type { Pool } from 'pg'
import request from 'supertest'

import {
  type Authorization,
  AUTHORIZATION,
  AuthorizationGuard,
  PublicRoute,
  RequiresPermission,
} from '../api/authorization.js'
import { ClosedIdentitySource } from '../api/closed-identity.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS, VERSION } from '../api/handed-in.js'
import { HealthController } from '../api/health.controller.js'
import {
  CurrentIdentity,
  IDENTITY_SOURCE,
  type IdentitySource,
  type RequestIdentity,
} from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import type { ServerApplication } from '../configuration.js'
import { Database } from '../database/database.js'
import { foundationMigration } from '../database/foundation-migration.js'
import { probeDatabase, probeMigrations } from '../database/probe-database.js'
import { probeMade } from '../database/probe-schema.js'
import { allowApplicationLogin, type TestDatabase } from '../database/test-database.js'
import type { InstanceSettingsCache } from '../instance/settings.js'
import type { MadeByTheApplication } from '../migration/guards.js'
import { memberships } from '../schema.js'
import type { AccessRules, MembershipAdditions } from './access.js'
import {
  type Authentication,
  type AuthenticationOptions,
  authenticationPath,
  createAuthentication,
} from './authentication.js'
import type { InvitationMailing } from './invitation-mailing.js'
import { authenticationParts } from './module.js'
import { writeRoles } from './roles.js'
import { SessionIdentitySource } from './session-identity.js'
import { type AuthenticatorSite, currentCode, TestAuthenticator } from './test-authenticator.js'

// The application the authentication is tested with, and it is nobody's: its
// own name, a catalogue with two rights of its own, three roles a tenant
// starts with, and one controller with what an application would keep behind
// the guard. A test that passed with the
// name or a role of a real application here would pass just as well with that
// name written into the foundation, which is what these tests are there to
// rule out.

/** What the application of these tests calls itself. */
export const probewerk: ServerApplication = {
  name: 'Probewerk',
  port: 24680,
  versionVariable: 'PROBEWERK_VERSION',
  passwordVariable: 'PROBEWERK_PASSWORD',
  exampleOrigin: 'https://probewerk.example.de',
  exampleDatabase: 'probewerk',
}

/** Where an instance of it is reached, and the host its passkeys are bound to. */
export const probeOrigin = 'https://probewerk.example.de'

export const probeSite: AuthenticatorSite = {
  relyingParty: 'probewerk.example.de',
  origin: probeOrigin,
}

/**
 * The rights the foundation asks for, and two of its own: one that reads and
 * one that writes.
 */
export const probeCatalogue = rightsCatalogue([
  accessRights.read,
  accessRights.write,
  'members.read',
  'notes.write',
])

export type ProbeRight = (typeof probeCatalogue.rights)[number]

/**
 * The roles a tenant of this application starts with: one leads it and needs
 * a second factor, one works in it, and one only looks. Whoever leads holds
 * everything, the administration of its people included, and nobody else
 * holds that.
 */
export const probeRoles: readonly RoleDefinition<ProbeRight>[] = [
  {
    key: 'lead',
    label: 'Leitung',
    rights: [accessRights.read, accessRights.write, 'members.read', 'notes.write'],
    leads: true,
    secondFactor: true,
  },
  {
    key: 'member',
    label: 'Mitglied',
    rights: ['members.read', 'notes.write'],
    leads: false,
    secondFactor: false,
  },
  { key: 'guest', label: 'Gast', rights: ['members.read'], leads: false, secondFactor: false },
]

export type ProbeIdentity = MemberIdentity<ProbeRight>

/**
 * What the list of somebody's tenants says about one of them, for somebody
 * who holds these of the roles a tenant of this application starts with: the
 * names of the roles and what they add up to, as a tenant has them that
 * changed nothing about its roles.
 */
export function probeChoice(
  tenant: { readonly id: string; readonly name: string },
  roles: readonly string[],
): TenantChoice<ProbeRight> {
  const held = probeRoles.filter((role) => roles.includes(role.key))
  const sum = probeCatalogue.sumOf(held)

  return {
    id: tenant.id as TenantId,
    name: tenant.name,
    roles,
    roleLabels: held.map((role) => role.label),
    rights: sum.rights,
    secondFactor: sum.secondFactor,
  }
}

/** The longest name a tenant of this application may have. */
const longestTenantName = 40

/** The rights, the roles and the words of this application, with a tenant called what the foundation calls it. */
export const probeAccess: AccessRules<ProbeRight> = {
  catalogue: probeCatalogue,
  shippedRoles: probeRoles,
  tenantNameProblem: (name) => {
    const trimmed = name.trim()

    if (trimmed === '') {
      return 'Der Name des Mandanten fehlt.'
    }

    return trimmed.length > longestTenantName
      ? `Der Name des Mandanten ist länger als ${String(longestTenantName)} Zeichen.`
      : null
  },
  sentences: {
    noTenantChosen: 'Es ist noch kein Mandant gewählt. Bitte zuerst einen Mandanten auswählen.',
    noAccessToTenant: 'Kein Zugang zu diesem Mandanten.',
    blockedInTenant: 'Dieser Zugang ist bei diesem Mandanten gesperrt.',
    alreadyWorksHere: 'Diese Adresse arbeitet schon bei diesem Mandanten.',
    notAMember: 'Dieses Konto arbeitet nicht bei diesem Mandanten.',
    noSuchSessionHere: 'Diese Sitzung gibt es bei diesem Mandanten nicht.',
    lastLead:
      'Das ist die letzte Leitung dieses Mandanten. Erst eine zweite einsetzen, sonst ' +
      'verwaltet niemand mehr seine Zugänge.',
    unusableLink: {
      redeemed: 'Dieser Link wurde schon benutzt. Bitte beim Mandanten einen neuen anfordern.',
      revoked: 'Dieser Link wurde zurückgezogen. Bitte beim Mandanten nachfragen.',
      expired: 'Dieser Link ist abgelaufen. Bitte beim Mandanten einen neuen anfordern.',
    },
    passkeyNotRecorded:
      'Der Passkey ließ sich nicht im Protokoll der Mandanten festhalten und ist deshalb ' +
      'nicht angelegt.',
    emptyInstance:
      'Diese Instanz ist noch leer: im Browser steht die Ersteinrichtung, die den ' +
      'Mandanten und den ersten Zugang anlegt.',
    addStaff: {
      usage: 'Aufruf: add-staff <mandant> <e-mail> "<name>" <rolle> [<rolle> ...]',
      added: (email, tenantId, roles) =>
        `${email} ist beim Mandanten ${tenantId} angelegt, Rollen: ${roles.join(', ')}.`,
      kept: (email, tenantId, roles) =>
        `${email} gab es schon. Die Rollen beim Mandanten ${tenantId} stehen jetzt auf: ` +
        `${roles.join(', ')}.`,
      secondFactor: 'Für die Leitung eines Mandanten ist ein zweiter Faktor Pflicht.',
      noSuchTenant: (tenantId) => `Den Mandanten ${tenantId} gibt es auf dieser Instanz nicht.`,
    },
    // Whoever runs an instance of this application is its "Hausmeisterei", a
    // word no real application has for it.
    instance: {
      alreadyOperator: 'Dieses Konto gehört schon zur Hausmeisterei der Instanz.',
      notAnOperator: 'Dieses Konto gehört nicht zur Hausmeisterei der Instanz.',
      notOneself: 'Aus der Hausmeisterei nimmt sich niemand selbst heraus.',
      lastOperator: 'Das letzte Konto der Hausmeisterei bleibt.',
      tenantNameMissing: 'Ein Mandant braucht einen Namen.',
      leadNameMissing: 'Der Name der Leitung fehlt.',
      leadEmailNotOne: 'Die E-Mail-Adresse der Leitung sieht nicht wie eine aus.',
      appointOperator: {
        usage: 'Aufruf: appoint-operator <e-mail>',
        appointed: (email) => `${email} gehört jetzt zur Hausmeisterei dieser Instanz.`,
        secondFactor: 'Für die Hausmeisterei ist ein zweiter Faktor Pflicht.',
        failed: 'Die Hausmeisterei ließ sich nicht erweitern.',
      },
      addTenant: {
        usage: 'Aufruf: add-tenant "<name des mandanten>" <e-mail> "<name der leitung>"',
        createdWithAccount: (name, tenantId, email) =>
          `Der Mandant "${name}" ist angelegt, Kennung ${tenantId}. ${email} leitet ihn, ` +
          'mit einem neuen Konto.',
        createdForAccount: (name, tenantId, email) =>
          `Der Mandant "${name}" ist angelegt, Kennung ${tenantId}. ${email} leitet ihn; ` +
          'das Konto gab es schon.',
        secondFactor: 'Für die Leitung eines Mandanten ist ein zweiter Faktor Pflicht.',
        failed: 'Der Mandant konnte nicht angelegt werden.',
      },
    },
  },
}

/** What the guard is told about this application. */
export const probeAuthorization: Authorization<ProbeRight> = {
  missingPermission: (right) => `Das Recht ${right} fehlt diesem Zugang.`,
  sentences: {
    operatorsOnly: 'Diesen Bereich erreicht nur die Hausmeisterei der Instanz.',
    workingInAnotherTenant: 'Diese Seite arbeitet noch bei einem anderen Mandanten.',
  },
}

/** How often the route that would write was reached, across every instance of a test file. */
export const reached = { written: 0 }

/**
 * What an application keeps behind the guard, as little of it as the tests
 * need: something of the tenant to read, something to write, and a route
 * anybody may call.
 */
@Controller('probe')
export class ProbeController {
  constructor(private readonly database: Database) {}

  @Get('health')
  @PublicRoute()
  health(): { status: 'ok' } {
    return { status: 'ok' }
  }

  /** Who works in the tenant of the session, read the way every route reads: inside it. */
  @Get('members')
  @RequiresPermission('members.read')
  members(
    @CurrentIdentity() identity: RequestIdentity<ProbeIdentity, ProbeRight>,
  ): Promise<{ userId: string; roles: readonly string[] }[]> {
    return this.database.forTenant(identity, (tx) =>
      tx.select({ userId: memberships.userId, roles: memberships.roles }).from(memberships),
    )
  }

  /** Writes nothing and counts that it was reached, which is what a refusal must prevent. */
  @Post('notes')
  @RequiresPermission('notes.write')
  note(@CurrentIdentity() identity: RequestIdentity<ProbeIdentity, ProbeRight>): {
    tenantId: TenantId
  } {
    reached.written += 1

    return { tenantId: identity.tenantId }
  }
}

/** What the module of the probe application is put together from. */
export interface ProbeModuleOptions {
  /** Handed in while the instance is open, as an application does it. */
  readonly authentication?: Authentication
  readonly setupCode?: string | null
  readonly trustedOrigins?: readonly string[]
  /** What sends an invitation by mail. Left out, this application hands out links. */
  readonly invitationMailing?: InvitationMailing | null
  /** The settings of the instance in memory, where a test keeps them there. */
  readonly instanceSettings?: InstanceSettingsCache | null
  /** The version the health check names; left out, it names none, as in a checkout. */
  readonly version?: string | null
  /** What this application keeps beside a membership. Left out, nothing. */
  readonly additions?: MembershipAdditions
}

@Module({})
export class ProbeModule {
  /** The HTTP side of the probe application, built the way an application builds its own. */
  static create(
    database: Database,
    identities: IdentitySource<ProbeIdentity>,
    options: ProbeModuleOptions = {},
  ): DynamicModule {
    const signingIn = authenticationParts({
      access: options.additions ? { ...probeAccess, additions: options.additions } : probeAccess,
      authentication: options.authentication,
      setupCode: options.setupCode,
      invitationMailing: options.invitationMailing,
      instanceSettings: options.instanceSettings,
    })

    return {
      module: ProbeModule,
      controllers: [HealthController, ProbeController, ...signingIn.controllers],
      providers: [
        { provide: Database, useValue: database },
        ...signingIn.providers,
        { provide: TRUSTED_ORIGINS, useValue: options.trustedOrigins ?? [] },
        { provide: VERSION, useValue: options.version ?? null },
        { provide: IDENTITY_SOURCE, useValue: identities },
        { provide: AUTHORIZATION, useValue: probeAuthorization },
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
      ],
    }
  }
}

/** The authentication of the probe application: under its name and in its words. */
export function probeAuthentication(
  options: Omit<AuthenticationOptions, 'application' | 'access'>,
): Authentication {
  return createAuthentication({ ...options, application: probewerk, access: probeAccess })
}

/** The identity of a session, with the roles of the probe application. */
export function probeIdentities(
  authentication: Authentication,
  database: Database,
): SessionIdentitySource<ProbeRight> {
  return new SessionIdentitySource(authentication, database, probeAccess)
}

/** What an instance of the probe application is started with. */
export interface ProbeInstanceOptions extends Pick<
  AuthenticationOptions,
  'rateLimited' | 'passwordResetMail' | 'passkeyNotice'
> {
  /** Signs the cookies. Its own per instance, so that two of them share no session. */
  readonly secret?: string
  /** The code the first run asks for. Left out, the first run is refused. */
  readonly setupCode?: string | null
  /** A closed instance recognises nobody and mounts no sign in. */
  readonly closed?: boolean
  /** What sends an invitation by mail. Left out, this application hands out links. */
  readonly invitationMailing?: InvitationMailing | null
  /** The settings of the instance in memory, where a test keeps them there. */
  readonly instanceSettings?: InstanceSettingsCache | null
  /** What this application keeps beside a membership. Left out, nothing. */
  readonly additions?: MembershipAdditions
}

/** A running instance of the probe application, and what a test asks of it. */
export interface ProbeInstance {
  readonly app: INestApplication
  readonly database: Database
  readonly authentication: Authentication
  /** A request against the instance. */
  http(): ReturnType<typeof request>
  /**
   * Signs in with the password and hands back the cookies as a browser would
   * send them, or nothing when the sign in was refused.
   */
  signIn(email: string, password: string): Promise<string>
  /** Chooses the tenant the session works in, as a registered device where one is named. */
  chooseTenant(cookies: string, tenantId: string, deviceId?: string): Promise<void>
  close(): Promise<void>
}

/** The cookies an answer set, the way a browser would keep them. */
export function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

/** Several sets of cookies as one header. */
export function joined(...cookies: string[]): string {
  return cookies.filter((cookie) => cookie !== '').join('; ')
}

/**
 * Starts an instance of the probe application on a database, the way `main`
 * of an application starts one: better-auth's routes in front of the body
 * parser, everything else behind the guard.
 */
export async function probeInstance(
  databaseUrl: string,
  options: ProbeInstanceOptions = {},
): Promise<ProbeInstance> {
  const {
    secret = 'z'.repeat(64),
    setupCode,
    closed = false,
    invitationMailing = null,
    instanceSettings = null,
    additions,
    ...authenticationOptions
  } = options
  const database = Database.connect(databaseUrl)
  const authentication = probeAuthentication({
    database,
    secret,
    trustedOrigins: [probeOrigin],
    // Off unless a test is about them. They count per address, and every
    // request of a test comes from the same one.
    rateLimited: false,
    ...authenticationOptions,
  })

  const built = await Test.createTestingModule({
    imports: [
      ProbeModule.create(
        database,
        closed ? new ClosedIdentitySource() : probeIdentities(authentication, database),
        closed
          ? { trustedOrigins: [probeOrigin], invitationMailing, instanceSettings }
          : {
              authentication,
              setupCode: setupCode ?? null,
              trustedOrigins: [probeOrigin],
              invitationMailing,
              instanceSettings,
              ...(additions ? { additions } : {}),
            },
      ),
    ],
  }).compile()

  const app = built.createNestApplication()

  if (!closed) {
    // In front of Nest's body parser, which is the order an instance uses and
    // the order that matters: a parser in front leaves better-auth with an
    // empty body and the failure reads like a wrong password.
    app.use(authenticationPath, toNodeHandler(authentication))
  }

  await app.init()

  const http = () => request(app.getHttpServer())

  return {
    app,
    database,
    authentication,
    http,
    async signIn(email, password) {
      const answer = await http()
        .post(`${authenticationPath}/sign-in/email`)
        .set('origin', probeOrigin)
        .send({ email, password })

      return answer.status === 200 ? cookiesOf(answer) : ''
    },
    async chooseTenant(cookies, tenantId, deviceId) {
      await http()
        .post('/auth/tenant')
        .set('cookie', cookies)
        .set('origin', probeOrigin)
        .send({ tenantId, ...(deviceId ? { deviceId } : {}) })
        .expect(201)
    },
    async close() {
      await app.close()
      await database.close()
    },
  }
}

/** People signing in to an instance, each with the second factor they have. */
export interface ProbeVisitors {
  /** Gives an account the second factor a role asks for. */
  setUpSecondFactor(email: string): Promise<void>
  /**
   * Signs in and answers the second factor where one is asked for, stopping
   * short of the choice of tenant. The cookies as a browser would send them.
   */
  signIn(email: string, password?: string): Promise<string>
  /** Signs in and chooses a tenant, which is where work actually starts. */
  workIn(email: string, tenantId: TenantId, password?: string): Promise<string>
}

/**
 * The people of a test at the door of an instance.
 *
 * Whoever has held a role that asks for a second factor has one, and it stays
 * on the account afterwards. Written once here and not in each test that
 * needs somebody to lead a tenant, because none of them is about that flow;
 * the tests of the first run are.
 */
export function probeVisitors(instance: ProbeInstance, password: string): ProbeVisitors {
  /** The address an authenticator app was fed, per account that has one. */
  const secondFactors = new Map<string, string>()

  const post = (path: string, cookies?: string) => {
    const sending = instance.http().post(`${authenticationPath}${path}`).set('origin', probeOrigin)

    return cookies ? sending.set('cookie', cookies) : sending
  }

  const signIn = async (email: string, secret = password): Promise<string> => {
    const answer = await post('/sign-in/email').send({ email, password: secret }).expect(200)
    const cookies = cookiesOf(answer)
    const totpUri = secondFactors.get(email)

    if ((answer.body as { twoFactorRedirect?: boolean }).twoFactorRedirect !== true || !totpUri) {
      return cookies
    }

    const verified = await post('/two-factor/verify-totp', cookies)
      .send({ code: await currentCode(totpUri) })
      .expect(200)

    return cookiesOf(verified) || cookies
  }

  return {
    signIn,
    async setUpSecondFactor(email) {
      const cookies = cookiesOf(await post('/sign-in/email').send({ email, password }).expect(200))
      const started = await post('/two-factor/enable', cookies)
        .send({ password, method: 'totp' })
        .expect(200)
      const totpUri = (started.body as { totpURI: string }).totpURI

      await post('/two-factor/verify-totp', cookies)
        .send({ code: await currentCode(totpUri) })
        .expect(200)

      secondFactors.set(email, totpUri)
    },
    async workIn(email, tenantId, secret = password) {
      const cookies = await signIn(email, secret)

      await instance.chooseTenant(cookies, tenantId)

      return cookies
    },
  }
}

/** A tenant of a test. */
export interface ProbeTenant {
  readonly id: TenantId
  readonly name: string
}

/** A test database that carries the foundation and nothing else. */
export interface ProbeFoundation {
  readonly kit: TestDatabase
  /** Back to the state a freshly started installation is in. */
  empty(admin: Pool): Promise<void>
  /**
   * Brings tenants into being the way an application does: the row, and the
   * roles a tenant starts with. A test that wrote the row alone would have a
   * tenant in which nobody holds a single right.
   */
  tenants(admin: Pool, tenants: readonly ProbeTenant[]): Promise<void>
  /** Removes the migrations folder the kit was built on. */
  remove(): void
}

/**
 * The kit for a database built from the building blocks of the foundation,
 * the way the first migration of a new application builds it, with the tables
 * the probe application makes with its own lists. The migration is put
 * together once, so that a test that starts from an empty instance every time
 * does not pay for it every time.
 *
 * A test that needs tables of the probe application beyond those hands them
 * in as `made`, the way an application lists what it makes.
 */
export async function probeFoundation(
  made: MadeByTheApplication = probeMade,
): Promise<ProbeFoundation> {
  const { up } = await foundationMigration(undefined, made)
  const folder = probeMigrations([{ tag: '0000_foundation', sql: up, when: 1 }])
  const kit = probeDatabase(folder)

  return {
    kit,
    async empty(admin) {
      await kit.resetSchema(admin)
      await kit.applyMigrations()
      await allowApplicationLogin(admin)
    },
    async tenants(admin, tenants) {
      const database = Database.connect(kit.applicationDatabaseUrl())

      try {
        for (const tenant of tenants) {
          // The row as whoever sets an instance up writes it: the application
          // role may not, which is the point of that grant.
          await admin.query('insert into tenants (id, name) values ($1, $2)', [
            tenant.id,
            tenant.name,
          ])
          // The roles as the application writes them, inside the tenant.
          await database.forTenant({ tenantId: tenant.id, reason: 'setup' }, (tx) =>
            writeRoles(tx, tenant.id, probeRoles),
          )
        }
      } finally {
        await database.close()
      }
    },
    remove() {
      rmSync(folder, { recursive: true, force: true })
    },
  }
}

/** An authenticator for the probe application, with one passkey. */
export function probeAuthenticator(): TestAuthenticator {
  return new TestAuthenticator(probeSite)
}
