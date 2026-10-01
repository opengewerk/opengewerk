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
import type { TenantId } from '@opengewerk/platform-domain'
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
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
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
import { allowApplicationLogin, type TestDatabase } from '../database/test-database.js'
import { memberships } from '../schema.js'
import type { AccessRules } from './access.js'
import {
  type Authentication,
  type AuthenticationOptions,
  authenticationPath,
  createAuthentication,
} from './authentication.js'
import { authenticationParts } from './module.js'
import { type MemberIdentity, SessionIdentitySource } from './session-identity.js'
import { type AuthenticatorSite, TestAuthenticator } from './test-authenticator.js'

// The application the authentication is tested with, and it is nobody's: its
// own name, two roles and two rights of its own, and one controller with what
// an application would keep behind the guard. A test that passed with the
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

export const probeRoles = ['lead', 'member'] as const

/** Two roles: one leads a tenant and needs a second factor, the other works in it. */
export type ProbeRole = (typeof probeRoles)[number]

/** Two rights, one that reads and one that writes. Both roles hold both. */
export type ProbeRight = 'members.read' | 'notes.write'

export type ProbeIdentity = MemberIdentity<ProbeRole>

/** The longest name a tenant of this application may have. */
const longestTenantName = 40

/** The roles and the words of this application, with a tenant called what the foundation calls it. */
export const probeAccess: AccessRules<ProbeRole> = {
  roles: probeRoles,
  leadingRole: 'lead',
  requiresSecondFactor: (roles) => roles.includes('lead'),
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
    unusableLink: {
      redeemed: 'Dieser Link wurde schon benutzt. Bitte beim Mandanten einen neuen anfordern.',
      revoked: 'Dieser Link wurde zurückgezogen. Bitte beim Mandanten nachfragen.',
      expired: 'Dieser Link ist abgelaufen. Bitte beim Mandanten einen neuen anfordern.',
    },
    passkeyNotRecorded:
      'Der Passkey ließ sich nicht im Protokoll der Mandanten festhalten und ist deshalb ' +
      'nicht angelegt.',
    addStaff: {
      usage: 'Aufruf: add-staff <mandant> <e-mail> "<name>" <rolle> [<rolle> ...]',
      added: (email, tenantId, roles) =>
        `${email} ist beim Mandanten ${tenantId} angelegt, Rollen: ${roles.join(', ')}.`,
      kept: (email, tenantId, roles) =>
        `${email} gab es schon. Die Rollen beim Mandanten ${tenantId} stehen jetzt auf: ` +
        `${roles.join(', ')}.`,
      secondFactor: 'Für die Leitung eines Mandanten ist ein zweiter Faktor Pflicht.',
    },
  },
}

/** What the guard is told about this application: both roles hold both rights. */
export const probeAuthorization: Authorization<ProbeIdentity, ProbeRight> = {
  isAllowed: (identity) => identity.roles.length > 0,
  missingPermission: (right) => `Das Recht ${right} fehlt diesem Zugang.`,
  // Nobody runs an instance of this application; the guard's part of that is
  // tested where the guard is (`api/authorization.test.ts`).
  operatorAccess: () => Promise.resolve({ operator: false, secondFactor: false }),
  sentences: {
    operatorsOnly: 'Diesen Bereich erreicht nur, wer die Probewerk-Instanz betreibt.',
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
      access: probeAccess,
      authentication: options.authentication,
      setupCode: options.setupCode,
    })

    return {
      module: ProbeModule,
      controllers: [ProbeController, ...signingIn.controllers],
      providers: [
        { provide: Database, useValue: database },
        ...signingIn.providers,
        { provide: TRUSTED_ORIGINS, useValue: options.trustedOrigins ?? [] },
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
): SessionIdentitySource<ProbeRole> {
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
  const { secret = 'z'.repeat(64), setupCode, closed = false, ...authenticationOptions } = options
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
          ? { trustedOrigins: [probeOrigin] }
          : { authentication, setupCode: setupCode ?? null, trustedOrigins: [probeOrigin] },
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

/** A test database that carries the foundation and nothing else. */
export interface ProbeFoundation {
  readonly kit: TestDatabase
  /** Back to the state a freshly started installation is in. */
  empty(admin: Pool): Promise<void>
  /** Removes the migrations folder the kit was built on. */
  remove(): void
}

/**
 * The kit for a database built from the building blocks of the foundation,
 * the way the first migration of a new application builds it. The migration
 * is put together once, so that a test that starts from an empty instance
 * every time does not pay for it every time.
 */
export async function probeFoundation(): Promise<ProbeFoundation> {
  const { up } = await foundationMigration()
  const folder = probeMigrations([{ tag: '0000_foundation', sql: up, when: 1 }])
  const kit = probeDatabase(folder)

  return {
    kit,
    async empty(admin) {
      await kit.resetSchema(admin)
      await kit.applyMigrations()
      await allowApplicationLogin(admin)
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
