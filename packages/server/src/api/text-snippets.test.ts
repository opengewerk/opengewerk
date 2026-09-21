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
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * The texts the office writes once and uses again. A list per business, kept
 * apart from every other business like everything else, and deleted for real
 * because no document depends on a snippet: inserting one copies its text.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const office = () => as(north.id, 'office')
const neighbour = () => as(south.id, 'office')

interface SnippetRow {
  readonly id: string
  readonly tenantId: string
  readonly purpose: string
  readonly title: string
  readonly text: string
}

function http() {
  return request(app.getHttpServer())
}

async function create(body: Record<string, unknown>, identity = office()) {
  const created = await http()
    .post('/documents/text-snippets')
    .set('x-test-identity', identity)
    .send(body)
    .expect(201)

  return created.body as SnippetRow
}

async function list(identity = office()) {
  const answer = await http()
    .get('/documents/text-snippets')
    .set('x-test-identity', identity)
    .expect(200)

  return answer.body as SnippetRow[]
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

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a text snippet', () => {
  it('is written, listed by purpose and name, changed and deleted', async () => {
    const closing = await create({
      purpose: 'closing',
      title: 'Gruß',
      text: 'Wir freuen uns auf Ihren Auftrag.\nMit freundlichen Grüßen',
    })
    const line = await create({
      purpose: 'line',
      title: '  Zählerschrank setzen  ',
      text: 'Zählerschrank nach VDE-AR-N 4100 liefern und setzen.',
    })
    const intro = await create({ purpose: 'intro', title: 'Anfrage', text: 'Vielen Dank.' })

    expect(line.title).toBe('Zählerschrank setzen')
    expect(closing.text).toBe('Wir freuen uns auf Ihren Auftrag.\nMit freundlichen Grüßen')
    expect((await list()).map((snippet) => snippet.id)).toEqual([line.id, intro.id, closing.id])

    const changed = await http()
      .patch(`/documents/text-snippets/${intro.id}`)
      .set('x-test-identity', office())
      .send({ text: 'Vielen Dank für Ihre Anfrage.' })
      .expect(200)

    expect(changed.body).toMatchObject({ title: 'Anfrage', text: 'Vielen Dank für Ihre Anfrage.' })

    await http()
      .delete(`/documents/text-snippets/${intro.id}`)
      .set('x-test-identity', office())
      .expect(200)

    expect((await list()).map((snippet) => snippet.id)).not.toContain(intro.id)
  })

  it('for a position may be a designation alone', async () => {
    const snippet = await create({ purpose: 'line', title: 'Anfahrt' })

    expect(snippet.text).toBe('')
  })

  it('for the text above or below the lines needs a text, also after a change', async () => {
    await http()
      .post('/documents/text-snippets')
      .set('x-test-identity', office())
      .send({ purpose: 'intro', title: 'Leer', text: '   ' })
      .expect(400)

    const line = await create({ purpose: 'line', title: 'Nur ein Name' })

    await http()
      .patch(`/documents/text-snippets/${line.id}`)
      .set('x-test-identity', office())
      .send({ purpose: 'closing' })
      .expect(400)
  })

  it('refuses a purpose it does not know, a missing name and an overlong text', async () => {
    const refusals = [
      { purpose: 'footer', title: 'Fuß', text: 'x' },
      { purpose: 'line', title: '   ', text: 'x' },
      { purpose: 'line', text: 'Ohne Namen' },
      { purpose: 'line', title: 'Zu lang', text: 'x'.repeat(10_001) },
      { purpose: 'line', title: 'Kein Text', text: 42 },
    ]

    for (const body of refusals) {
      await http()
        .post('/documents/text-snippets')
        .set('x-test-identity', office())
        .send(body)
        .expect(400)
    }
  })

  it('stays with its business', async () => {
    const own = await create({ purpose: 'line', title: 'Nordisch', text: 'Nur im Norden.' })

    expect((await list(neighbour())).map((snippet) => snippet.id)).not.toContain(own.id)

    await http()
      .patch(`/documents/text-snippets/${own.id}`)
      .set('x-test-identity', neighbour())
      .send({ title: 'Übernommen' })
      .expect(404)

    await http()
      .delete(`/documents/text-snippets/${own.id}`)
      .set('x-test-identity', neighbour())
      .expect(404)

    expect((await list()).find((snippet) => snippet.id === own.id)?.title).toBe('Nordisch')
  })

  it('is kept by whoever may write documents and read by whoever may read them', async () => {
    await http()
      .post('/documents/text-snippets')
      .set('x-test-identity', as(north.id))
      .send({ purpose: 'line', title: 'Ohne Recht' })
      .expect(403)

    await http().get('/documents/text-snippets').set('x-test-identity', as(north.id)).expect(403)

    await create({ purpose: 'line', title: 'Vor Ort' }, as(north.id, 'technician'))
  })

  it('leaves its deletion in the audit log', async () => {
    const snippet = await create({ purpose: 'line', title: 'Vergänglich', text: 'Bald weg.' })

    await http()
      .delete(`/documents/text-snippets/${snippet.id}`)
      .set('x-test-identity', office())
      .expect(200)

    const { rows } = await admin.query<{ operation: string; oldValue: string | null }>(
      `select operation, old_value as "oldValue" from audit_entries
        where table_name = 'text_snippets' and record_id = $1 and field = 'text'
        order by sequence`,
      [snippet.id],
    )

    expect(rows).toEqual([
      { operation: 'insert', oldValue: null },
      { operation: 'delete', oldValue: 'Bald weg.' },
    ])
  })
})
