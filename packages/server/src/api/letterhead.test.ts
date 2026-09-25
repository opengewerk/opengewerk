import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The letterhead, through HTTP. What is worth testing is who may change it,
 * what it refuses, and that the logo is what it claims to be: the letterhead
 * ends up on every document the business sends, and a wrong IBAN or a file
 * that is no image would go out with all of them.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string

const owner = () => as(north.id, 'owner')

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function http() {
  return request(app.getHttpServer())
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-letterhead-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { files: new FileStore(storageRoot) })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('a letterhead nobody has filled in yet', () => {
  it('is empty, and names the business it was set up as', async () => {
    const answer = await http()
      .get('/settings/letterhead')
      .set('x-test-identity', as(north.id, 'office'))
      .expect(200)

    expect(answer.body).toMatchObject({
      companyName: null,
      street: null,
      country: 'DE',
      taxNumber: null,
      setUpAs: 'Elektro Nord GmbH',
      logo: null,
    })
  })
})

describe('writing the letterhead', () => {
  it('belongs to the owner, and the office may only read it', async () => {
    await http()
      .put('/settings/letterhead')
      .set('x-test-identity', as(north.id, 'office'))
      .send({ street: 'Hafenstraße' })
      .expect(403)
  })

  it('keeps what was sent, trimmed, and empties what was left out', async () => {
    const answer = await http()
      .put('/settings/letterhead')
      .set('x-test-identity', owner())
      .send({
        companyName: '  Elektro Nord GmbH  ',
        street: 'Hafenstraße',
        houseNumber: '12',
        postalCode: '20457',
        city: 'Hamburg',
        taxNumber: '22/815/08154',
        iban: 'DE89 3704 0044 0532 0130 00',
        website: '',
      })
      .expect(200)

    expect(answer.body).toMatchObject({
      companyName: 'Elektro Nord GmbH',
      street: 'Hafenstraße',
      taxNumber: '22/815/08154',
      iban: 'DE89 3704 0044 0532 0130 00',
      website: null,
      email: null,
      country: 'DE',
    })
  })

  it('refuses an IBAN whose check digits do not add up', async () => {
    const refused = await http()
      .put('/settings/letterhead')
      .set('x-test-identity', owner())
      .send({ iban: 'DE89 3704 0044 0532 0130 01' })
      .expect(400)

    expect((refused.body as { message: string }).message).toContain('Prüfziffern')
  })

  it('names a field that is too long as the screen names it (#221)', async () => {
    const refused = await http()
      .put('/settings/letterhead')
      .set('x-test-identity', owner())
      .send({ companyName: 'x'.repeat(301) })
      .expect(400)

    expect((refused.body as { message: string }).message).toBe(
      '„Name auf den Belegen“ ist länger als 300 Zeichen, für einen Briefkopf zu lang.',
    )
  })

  it('refuses a country that is not a two letter code', async () => {
    await http()
      .put('/settings/letterhead')
      .set('x-test-identity', owner())
      .send({ country: 'Deutschland' })
      .expect(400)
  })

  it('is not seen by the business next door', async () => {
    const answer = await http()
      .get('/settings/letterhead')
      .set('x-test-identity', as(south.id, 'owner'))
      .expect(200)

    expect(answer.body).toMatchObject({
      street: null,
      taxNumber: null,
      setUpAs: 'Elektro Süd GmbH',
    })
  })
})

describe('the logo', () => {
  it('is stored as the image it is and comes back the same', async () => {
    const answer = await http()
      .put('/settings/letterhead/logo')
      .set('x-test-identity', owner())
      .set('content-type', 'image/png')
      .send(png)
      .expect(200)

    expect(answer.body).toMatchObject({ logo: { mediaType: 'image/png', sizeBytes: png.length } })

    const logo = await http()
      .get('/settings/letterhead/logo')
      .set('x-test-identity', as(north.id, 'office'))
      .buffer(true)
      .parse(binary)
      .expect(200)

    expect(logo.headers['content-type']).toBe('image/png')
    expect(Buffer.compare(logo.body as Buffer, png)).toBe(0)
  })

  it('is judged by its bytes, not by the type it was sent with', async () => {
    const refused = await http()
      .put('/settings/letterhead/logo')
      .set('x-test-identity', owner())
      .set('content-type', 'image/png')
      .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
      .expect(415)

    expect((refused.body as { message: string }).message).toContain('PNG- oder JPEG')
  })

  it('is refused when it is larger than a logo needs to be, with a sentence either way', async () => {
    const large = Buffer.concat([png, Buffer.alloc(1_200_000)])

    const byTheController = await http()
      .put('/settings/letterhead/logo')
      .set('x-test-identity', owner())
      .set('content-type', 'image/png')
      .send(large)
      .expect(413)
    expect((byTheController.body as { message: string }).message).toContain('MB')

    await http()
      .put('/settings/letterhead/logo')
      .set('x-test-identity', owner())
      .set('content-type', 'image/png')
      .send(Buffer.concat([png, Buffer.alloc(3_000_000)]))
      .expect(413)
  })

  it('can be taken off again, and the file stays for what was printed with it', async () => {
    const answer = await http()
      .delete('/settings/letterhead/logo')
      .set('x-test-identity', owner())
      .expect(200)

    expect((answer.body as { logo: unknown }).logo).toBeNull()

    await http().get('/settings/letterhead/logo').set('x-test-identity', owner()).expect(404)

    const { rows } = await admin.query<{ count: string }>(
      "select count(*) from files where media_type = 'image/png'",
    )
    expect(Number(rows[0]?.count)).toBe(1)
  })

  it('belongs to the owner as well', async () => {
    await http()
      .put('/settings/letterhead/logo')
      .set('x-test-identity', as(north.id, 'office'))
      .set('content-type', 'image/png')
      .send(png)
      .expect(403)
  })
})
