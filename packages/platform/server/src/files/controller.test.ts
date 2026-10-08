import 'reflect-metadata'

import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type DynamicModule, type INestApplication, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { largestFileBytes, type MemberIdentity, type TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AUTHORIZATION, AuthorizationGuard } from '../api/authorization.js'
import { databaseErrors } from '../api/database-errors.js'
import { TRUSTED_ORIGINS } from '../api/handed-in.js'
import { IDENTITY_SOURCE } from '../api/identity.js'
import { SameOriginGuard } from '../api/origin.js'
import { headerIdentities, testIdentityHeader } from '../api/test-identity.js'
import {
  probeAccess,
  probeAuthorization,
  type ProbeFoundation,
  probeFoundation,
  type ProbeRight,
} from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { fileParts } from './controller.js'
import { FileStore } from './store.js'

/**
 * The route the bytes of a file are stored through (#23), for an application
 * that is nobody's: the probe application, whose people store a file with the
 * right to write a note. What the route holds: the bytes are stored under
 * their hash with the type they show, once however often they come, never as
 * a picture because of a declared type alone; what does not match its hash,
 * is no byte stream, is empty or too large is refused; only whoever has the
 * right the application named stores one; and the store is shared while every
 * tenant reaches a file through a row of its own.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Mandant Nord' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Mandant Süd' }

const people = {
  mia: { tenant: north.id, rights: ['notes.write'] },
  gero: { tenant: north.id, rights: ['members.read'] },
  susi: { tenant: south.id, rights: ['notes.write'] },
} as const satisfies Record<string, { tenant: TenantId; rights: readonly ProbeRight[] }>

type Person = keyof typeof people

/** The smallest PNG there is, one transparent pixel. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const plan = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const notes = Buffer.from('Zähler 1: 12345 kWh\n')

let foundation: ProbeFoundation
let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function identityOf(person: Person): string {
  const { tenant, rights } = people[person]
  const identity: MemberIdentity<ProbeRight> = {
    userId: person,
    tenantId: tenant,
    roles: [],
    rights: [...rights],
  }

  return JSON.stringify(identity)
}

async function upload(bytes: Buffer, mediaType: string, person: Person = 'mia', expected = 200) {
  const answer = await request(app.getHttpServer())
    .put(`/files/${hashOf(bytes)}`)
    .set(testIdentityHeader, identityOf(person))
    .set('Content-Type', 'application/octet-stream')
    .set('X-Media-Type', mediaType)
    .send(bytes)
    .expect(expected)

  return answer.body as { sha256: string; sizeBytes: number; mediaType: string }
}

/**
 * The module of an application, as far as the file store goes: the route and
 * its store. Nothing reads the body in front of the route.
 */
@Module({})
class ProbeFilesModule {
  static create(database: Database, store: FileStore): DynamicModule {
    const parts = fileParts({ access: probeAccess, upload: 'notes.write', store })

    return {
      module: ProbeFilesModule,
      controllers: parts.controllers,
      providers: [
        { provide: Database, useValue: database },
        ...parts.providers,
        { provide: IDENTITY_SOURCE, useValue: headerIdentities<MemberIdentity<ProbeRight>>() },
        { provide: AUTHORIZATION, useValue: probeAuthorization },
        { provide: TRUSTED_ORIGINS, useValue: [] },
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: databaseErrors().DatabaseExceptionFilter },
      ],
    }
  }
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north, south])
  database = Database.connect(foundation.kit.applicationDatabaseUrl())
  storageRoot = mkdtempSync(join(tmpdir(), 'file-route-'))

  app = (
    await Test.createTestingModule({
      imports: [ProbeFilesModule.create(database, new FileStore(storageRoot))],
    }).compile()
  ).createNestApplication()
  // Listening, so that a test can send the head of a request and hold back
  // its body.
  await app.listen(0, '127.0.0.1')
}, 60_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  foundation.remove()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the route of the file store', () => {
  it('is refused to an application whose catalogue lacks the right it names', () => {
    expect(() => fileParts({ access: probeAccess, upload: 'letters.write' as ProbeRight })).toThrow(
      'The catalogue lacks the right to store a file: letters.write',
    )
  })
})

describe('the bytes of a file', () => {
  it('are stored under their hash, with the type the bytes show', async () => {
    const stored = await upload(png, 'application/octet-stream')

    expect(stored).toEqual({
      sha256: hashOf(png),
      sizeBytes: png.byteLength,
      mediaType: 'image/png',
    })
  })

  it('are stored once, however often they are sent', async () => {
    await upload(plan, 'application/pdf')
    await upload(plan, 'application/pdf')

    const { rows } = await admin.query(
      'select count(*)::int as count from files where tenant_id = $1 and sha256 = $2',
      [north.id, hashOf(plan)],
    )

    expect(rows[0]).toEqual({ count: 1 })
  })

  it('are never recorded as a picture because of a declared type alone', async () => {
    const pretending = Buffer.from('<script>alert(1)</script>')

    expect((await upload(pretending, 'image/png')).mediaType).toBe('application/octet-stream')
    expect((await upload(notes, 'text/plain; charset=utf-8')).mediaType).toBe('text/plain')
  })

  it('are refused when they do not match the hash they were sent under', async () => {
    const answer = await request(app.getHttpServer())
      .put(`/files/${hashOf(plan)}`)
      .set(testIdentityHeader, identityOf('mia'))
      .set('Content-Type', 'application/octet-stream')
      .send(notes)
      .expect(422)

    expect((answer.body as { message: string }).message).toMatch(/Prüfsumme/)
  })

  it('are refused under a name that is no hash', async () => {
    await request(app.getHttpServer())
      .put('/files/..%2F..%2Fetc%2Fpasswd')
      .set(testIdentityHeader, identityOf('mia'))
      .set('Content-Type', 'application/octet-stream')
      .send(notes)
      .expect(400)
  })

  it('are refused as anything but a byte stream, empty, or above the limit', async () => {
    await request(app.getHttpServer())
      .put(`/files/${hashOf(notes)}`)
      .set(testIdentityHeader, identityOf('mia'))
      .set('Content-Type', 'text/plain')
      .send(notes.toString())
      .expect(415)
    await request(app.getHttpServer())
      .put(`/files/${hashOf(Buffer.alloc(0))}`)
      .set(testIdentityHeader, identityOf('mia'))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0))
      .expect(400)

    const tooLarge = Buffer.alloc(largestFileBytes + 1, 1)
    // The sentence of the route and not the one of the parser in front of it.
    const answer = await request(app.getHttpServer())
      .put(`/files/${hashOf(tooLarge)}`)
      .set(testIdentityHeader, identityOf('mia'))
      .set('Content-Type', 'application/octet-stream')
      .send(tooLarge)
      .expect(413)

    expect((answer.body as { message: string }).message).toMatch(/größer als 25 MB/)
  })

  it('are stored only by whoever has the right the application named', async () => {
    await upload(notes, 'text/plain', 'gero', 403)
  })

  /**
   * A file may be 25 MB, and a parser in front of the route took all of it
   * into memory before a guard had asked who was sending: for a request
   * without a session, megabytes were read and then turned away
   * (opengewerk-haustechnik#31).
   *
   * So the head of a request announces 20 MB here and its body never comes.
   * A server that reads first waits for it; one that asks first answers.
   */
  it('are not waited for when nobody is signed in, or somebody without the right', async () => {
    const withoutItsBody = (identity: string | null) =>
      new Promise<number>((resolve, reject) => {
        const { port } = app.getHttpServer().address() as AddressInfo
        const sent = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'PUT',
            path: `/files/${hashOf(notes)}`,
            headers: {
              'content-type': 'application/octet-stream',
              'content-length': String(20 * 1024 * 1024),
              ...(identity === null ? {} : { [testIdentityHeader]: identity }),
            },
          },
          (answer) => {
            clearTimeout(waiting)
            answer.resume()
            sent.destroy()
            resolve(answer.statusCode ?? 0)
          },
        )
        const waiting = setTimeout(() => {
          sent.destroy()
          reject(new Error('The server waited for the body before it answered.'))
        }, 3000)

        // A connection cut after the answer is how this ends, not a failure.
        sent.on('error', () => undefined)
        sent.write(Buffer.alloc(1024))
      })

    expect(await withoutItsBody(null)).toBe(401)
    expect(await withoutItsBody(identityOf('gero'))).toBe(403)
  })

  it('lie in the store once, and every tenant reaches them through a row of its own', async () => {
    const shared = Buffer.from('Beide Mandanten legen dieselbe Datei ab.\n')

    await upload(shared, 'text/plain', 'mia')
    await upload(shared, 'text/plain', 'susi')

    const { rows } = await admin.query<{ tenant_id: string }>(
      'select tenant_id from files where sha256 = $1 order by tenant_id',
      [hashOf(shared)],
    )
    const hash = hashOf(shared)
    const onDisk = readdirSync(join(storageRoot, hash.slice(0, 2), hash.slice(2, 4)))

    expect(rows.map((row) => row.tenant_id)).toEqual([north.id, south.id].sort())
    expect(onDisk).toEqual([hash])
  })
})
