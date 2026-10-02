import 'reflect-metadata'

import { Controller, Get, type INestApplication, Module, Post } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { MemberIdentity } from '@opengewerk/platform-domain'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  type Authorization,
  AUTHORIZATION,
  AuthorizationGuard,
  PublicRoute,
  RequiresOperator,
  RequiresPermission,
  RequiresSession,
} from './authorization.js'
import { TRUSTED_ORIGINS } from './handed-in.js'
import {
  CurrentIdentity,
  CurrentUser,
  IDENTITY_SOURCE,
  type IdentitySource,
  type RequestIdentity,
  type SignedInUser,
} from './identity.js'
import { SameOriginGuard } from './origin.js'
import { routesOf, undeclared } from './routes.js'
import { headerIdentities, testIdentityHeader } from './test-identity.js'

// The guard with an application that is nobody's: two rights, an identity
// that carries the rights it holds, and one controller with a route of every
// kind. What is held here is the mechanism every application relies on: who
// is asking is settled before a handler runs, and a route that says nothing
// about what it needs is refused.

type ProbeRight = 'probe.read' | 'probe.write'

type ProbeIdentity = MemberIdentity<ProbeRight>

const instance = 'https://probe.example.org'
const tenant = newId<'tenant'>()
const otherTenant = newId<'tenant'>()

const authorization: Authorization<ProbeRight> = {
  missingPermission: (right) => `Das Recht ${right} fehlt diesem Zugang.`,
  sentences: {
    operatorsOnly: 'Diesen Bereich erreicht nur, wer die Probe-Instanz betreibt.',
    workingInAnotherTenant: 'Diese Seite arbeitet noch in einem anderen Mandanten.',
  },
}

/** Counts what the guard asks, so that a test can say it asked nothing. */
let asked = 0
const believed = headerIdentities<ProbeIdentity>()
const identities: IdentitySource<ProbeIdentity> = {
  identify: (incoming) => {
    asked += 1

    return believed.identify(incoming)
  },
  authenticate: (incoming) => {
    asked += 1

    return believed.authenticate(incoming)
  },
}

@Controller('probe')
class ProbeController {
  @Get()
  @RequiresPermission('probe.read')
  read(@CurrentIdentity() identity: RequestIdentity<ProbeIdentity, ProbeRight>) {
    return { userId: identity.userId, tenantId: identity.tenantId, reason: identity.reason }
  }

  @Post()
  @RequiresPermission('probe.write')
  write(@CurrentIdentity() identity: RequestIdentity<ProbeIdentity, ProbeRight>) {
    return { reason: identity.reason }
  }

  @Get('open')
  @PublicRoute()
  open() {
    return { open: true }
  }

  @Get('me')
  @RequiresSession()
  me(@CurrentUser() user: SignedInUser) {
    return user
  }

  @Get('instance')
  @RequiresOperator()
  area(@CurrentUser() user: SignedInUser) {
    return { userId: user.userId }
  }

  // No decorator, as on a route somebody wrote in a hurry.
  @Get('forgotten')
  forgotten() {
    return { reached: true }
  }
}

const database = Database.connect('postgres://unused')

@Module({
  controllers: [ProbeController],
  providers: [
    { provide: Database, useValue: database },
    { provide: IDENTITY_SOURCE, useValue: identities },
    { provide: AUTHORIZATION, useValue: authorization },
    { provide: TRUSTED_ORIGINS, useValue: [instance] },
    // In the order an application registers them: where a request comes from
    // is settled before anybody asks whose session it carries.
    { provide: APP_GUARD, useClass: SameOriginGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
})
class ProbeModule {}

let app: INestApplication

function as(userId: string, tenantId: string | undefined, ...rights: ProbeRight[]): string {
  // The rights, as an identity carries them. How somebody came by them, which
  // roles of which tenant, is not the guard's question.
  return JSON.stringify({ userId, tenantId, roles: [], rights })
}

function http() {
  return request(app.getHttpServer())
}

beforeAll(async () => {
  const built = await Test.createTestingModule({ imports: [ProbeModule] }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(() => {
  asked = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
})

describe('a route that declares a right', () => {
  it('answers somebody who holds it, and hands the right on as the reason', async () => {
    const answer = await http()
      .get('/probe')
      .set(testIdentityHeader, as('reader', tenant, 'probe.read'))
      .expect(200)

    expect(answer.body).toEqual({ userId: 'reader', tenantId: tenant, reason: 'probe.read' })
  })

  it('refuses somebody who does not, in the words of the application', async () => {
    const refused = await http()
      .post('/probe')
      .set(testIdentityHeader, as('reader', tenant, 'probe.read'))
      .expect(403)

    expect((refused.body as { message: string }).message).toBe(
      'Das Recht probe.write fehlt diesem Zugang.',
    )
  })

  it('refuses a request without an identity as not signed in, not as forbidden', async () => {
    const refused = await http().get('/probe').expect(401)

    expect((refused.body as { message: string }).message).toBe('Keine gültige Anmeldung.')
  })
})

describe('a route that declares nothing', () => {
  it('is refused for everybody, whatever they hold', async () => {
    // A forgotten decorator has to fail closed. Guessing what the route needs
    // would be worse than refusing it.
    const refused = await http()
      .get('/probe/forgotten')
      .set(testIdentityHeader, as('writer', tenant, 'probe.read', 'probe.write'))
      .expect(403)

    expect((refused.body as { message: string }).message).toBe('Diese Route deklariert kein Recht.')
  })

  it('is what the walk over the routes of a module finds', () => {
    const routes = routesOf([ProbeController])

    expect(routes.map((route) => route.name).sort()).toEqual([
      'GET /probe',
      'GET /probe/forgotten',
      'GET /probe/instance',
      'GET /probe/me',
      'GET /probe/open',
      'POST /probe',
    ])
    expect(undeclared(routes).map((route) => route.name)).toEqual(['GET /probe/forgotten'])
    expect(routes.filter((route) => route.isPublic).map((route) => route.name)).toEqual([
      'GET /probe/open',
    ])
    expect(routes.find((route) => route.name === 'POST /probe')).toMatchObject({
      writes: true,
      permission: 'probe.write',
    })
  })
})

describe('a public route', () => {
  it('answers anybody and asks nobody who they are', async () => {
    // Asking the identity source would mean a health check stops answering
    // the moment the authentication has a problem, which is the one moment
    // somebody needs an answer from it.
    await http().get('/probe/open').expect(200, { open: true })

    expect(asked).toBe(0)
  })
})

describe('a route for somebody signed in who has chosen no tenant', () => {
  it('answers with a session and without a tenant or a right', async () => {
    const answer = await http()
      .get('/probe/me')
      .set(testIdentityHeader, as('newcomer', undefined))
      .expect(200)

    expect(answer.body).toEqual({ userId: 'newcomer', sessionId: 'test-session-newcomer' })
  })

  it('refuses whoever is not signed in', async () => {
    await http().get('/probe/me').expect(401)
  })
})

/**
 * Who runs the instance the guard asks the area of the instance itself, and
 * that is rows in a database, which this file does without. What the guard
 * makes of the answer is held where the rows are, in
 * `instance/instance.test.ts`: whoever runs it with a second factor gets in,
 * whoever leads a tenant and nothing else does not, and without a second
 * factor nobody does.
 */
describe('a route of the area of the instance', () => {
  it('refuses whoever is not signed in, before anything is asked about them', async () => {
    await http().get('/probe/instance').expect(401)
  })
})

describe('a page that names the tenant it works in', () => {
  const reader = as('reader', tenant, 'probe.read')

  it('is answered when it is the tenant of the session, and when it names none', async () => {
    await http()
      .get('/probe')
      .set(testIdentityHeader, reader)
      .set('X-OpenGewerk-Tenant', tenant)
      .expect(200)
    await http().get('/probe').set(testIdentityHeader, reader).expect(200)
  })

  it('is refused as not signed in when the session has moved to another', async () => {
    // A switch in another tab moves the session and not this page, which
    // would otherwise send its outbox into a tenant it does not show.
    const refused = await http()
      .get('/probe')
      .set(testIdentityHeader, reader)
      .set('X-OpenGewerk-Tenant', otherTenant)
      .expect(401)

    expect((refused.body as { message: string }).message).toBe(
      'Diese Seite arbeitet noch in einem anderen Mandanten.',
    )
  })
})

describe('a change from a foreign page', () => {
  it('is refused before anybody asks whose session it carries', async () => {
    await http()
      .post('/probe')
      .set(testIdentityHeader, as('writer', tenant, 'probe.write'))
      .set('origin', 'https://elsewhere.example.org')
      .expect(403)

    expect(asked).toBe(0)
  })

  it('goes through from the address of the instance', async () => {
    await http()
      .post('/probe')
      .set(testIdentityHeader, as('writer', tenant, 'probe.write'))
      .set('origin', instance)
      .expect(201, { reason: 'probe.write' })
  })
})
