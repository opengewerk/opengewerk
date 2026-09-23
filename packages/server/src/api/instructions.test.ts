import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { wordingAt } from '@opengewerk/domain'
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
import { todayInGermany } from '../today.js'

/**
 * The instructions a business hands its customers with a document, #109: the
 * shipped ones come into being on the first read, the owner changes and
 * restores them, and writes its own.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const owner = () => as(north.id, 'owner')
const office = () => as(north.id, 'office')
const neighbour = () => as(south.id, 'owner')

interface InstructionView {
  readonly id: string
  readonly template: string | null
  readonly title: string
  readonly body: string
  readonly changed: boolean
  readonly model: {
    readonly validFrom: string
    readonly source: string
    readonly text: string
  } | null
  readonly newerModel: { readonly validFrom: string; readonly source: string } | null
  readonly kinds: readonly string[]
  readonly consumersOnly: boolean
  readonly withDocument: boolean
  readonly position: number
}

function http() {
  return request(app.getHttpServer())
}

async function list(identity = owner()) {
  const answer = await http()
    .get('/settings/instructions')
    .set('x-test-identity', identity)
    .expect(200)

  return answer.body as InstructionView[]
}

async function shipped(template: string, identity = owner()) {
  const found = (await list(identity)).find((entry) => entry.template === template)

  if (!found) {
    throw new Error(`No ${template}.`)
  }

  return found
}

function change(id: string, body: Record<string, unknown>, identity = owner()) {
  return http().patch(`/settings/instructions/${id}`).set('x-test-identity', identity).send(body)
}

const model = () => wordingAt('withdrawal', todayInGermany())?.text ?? ''

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

describe('the shipped instructions', () => {
  it('come into being on the first read, once, with the settings they start out with', async () => {
    const first = await list(office())
    const second = await list()

    expect(first.map((entry) => [entry.template, entry.title])).toEqual([
      ['withdrawal', 'Widerrufsbelehrung'],
      ['withdrawal_notes', 'Hinweise zum Erlöschen des Widerrufsrechts'],
      ['withdrawal_form', 'Muster-Widerrufsformular'],
      ['early_start', 'Verlangen auf vorzeitigen Leistungsbeginn'],
    ])
    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id))
    expect(first[0]).toMatchObject({
      changed: false,
      kinds: ['quote'],
      requiredWith: ['quote'],
      consumersOnly: true,
      withDocument: true,
    })
    expect(first[1]).toMatchObject({ requiredWith: ['quote'], withDocument: true })
    expect(first[3]).toMatchObject({
      kinds: ['quote'],
      requiredWith: [],
      withDocument: false,
    })

    const { rows } = await admin.query<{ count: string }>(
      'select count(*) from instructions where tenant_id = $1',
      [north.id],
    )

    expect(rows[0]?.count).toBe('4')
  })

  it('show the model in force today, word for word, without keeping it in the row', async () => {
    const withdrawal = await shipped('withdrawal')

    expect(withdrawal.body).toBe(model())
    expect(withdrawal.model?.source).toContain('Anlage 1 zu Art. 246a')
    expect(withdrawal.newerModel).toBeNull()

    const { rows } = await admin.query<{ body: string | null }>(
      'select body from instructions where id = $1',
      [withdrawal.id],
    )

    expect(rows[0]?.body).toBeNull()
  })

  it('are a business of their own, out of reach of its neighbour', async () => {
    const theirs = await list(neighbour())
    const ours = await shipped('withdrawal')

    expect(theirs.map((entry) => entry.id)).not.toContain(ours.id)
    await change(ours.id, { withDocument: false }, neighbour()).expect(404)
  })
})

describe('an instruction changed', () => {
  it('is only for the owner; the office reads', async () => {
    const withdrawal = await shipped('withdrawal', office())

    await change(withdrawal.id, { consumersOnly: false }, office()).expect(403)
    await http()
      .post('/settings/instructions')
      .set('x-test-identity', office())
      .send({ title: 'AGB', body: 'Es gelten unsere AGB.' })
      .expect(403)
    await http()
      .post(`/settings/instructions/${withdrawal.id}/restore`)
      .set('x-test-identity', office())
      .expect(403)
  })

  it('keeps its words once the owner changes the model, marked as changed', async () => {
    const withdrawal = await shipped('withdrawal')
    const changed = await change(withdrawal.id, {
      body: `${model()}\n\nErgänzt vom Betrieb.`,
    }).expect(200)

    expect(changed.body).toMatchObject({ changed: true, newerModel: null })
    expect((changed.body as InstructionView).body.endsWith('Ergänzt vom Betrieb.')).toBe(true)

    const { rows } = await admin.query<{ based_on: string | null }>(
      "select to_char(based_on, 'YYYY-MM-DD') as based_on from instructions where id = $1",
      [withdrawal.id],
    )

    expect(rows[0]?.based_on).toBe('2026-06-19')
  })

  it('is the model again when the model is saved back, or restored', async () => {
    const withdrawal = await shipped('withdrawal')

    const pasted = await change(withdrawal.id, {
      body: `\r\n${model().replaceAll('\n', '\r\n')}  `,
    })

    expect(pasted.body).toMatchObject({ changed: false })

    await change(withdrawal.id, { body: 'Kurz und falsch.' }).expect(200)

    const restored = await http()
      .post(`/settings/instructions/${withdrawal.id}/restore`)
      .set('x-test-identity', owner())
      .expect(201)

    expect(restored.body).toMatchObject({ changed: false, body: model() })
  })

  it('says so when the model it was changed from is older than the newest', async () => {
    const withdrawal = await shipped('withdrawal')

    await change(withdrawal.id, { body: 'Eigene Fassung.' }).expect(200)
    await admin.query("update instructions set based_on = '2022-05-28' where id = $1", [
      withdrawal.id,
    ])

    expect((await shipped('withdrawal')).newerModel).toMatchObject({ validFrom: '2026-06-19' })

    await http()
      .post(`/settings/instructions/${withdrawal.id}/restore`)
      .set('x-test-identity', owner())
      .expect(201)
  })

  it('keeps the heading of its model', async () => {
    const withdrawal = await shipped('withdrawal')
    const refused = await change(withdrawal.id, { title: 'Belehrung' }).expect(400)

    expect((refused.body as { message: string }).message).toContain('Überschrift ihres Musters')
  })

  it('refuses a placeholder OpenGewerk does not know, and says which there are', async () => {
    const withdrawal = await shipped('withdrawal')
    const refused = await change(withdrawal.id, { body: 'Schreiben Sie an {adresse}.' }).expect(400)

    expect((refused.body as { message: string }).message).toContain('{adresse}')
    expect((refused.body as { message: string }).message).toContain('{anschrift}')
  })

  it('takes the kinds in the order of the list, each once, and refuses one that is none', async () => {
    const early = await shipped('early_start')

    const changed = await change(early.id, {
      kinds: ['order_confirmation', 'quote', 'quote'],
      withDocument: true,
    }).expect(200)

    expect(changed.body).toMatchObject({
      kinds: ['quote', 'order_confirmation'],
      withDocument: true,
    })

    await change(early.id, { kinds: ['brief'] }).expect(400)
    await change(early.id, { kinds: 'quote' }).expect(400)
    await change(early.id, { consumersOnly: 'ja' }).expect(400)
    await change(early.id, { kinds: ['quote'], withDocument: false }).expect(200)
  })

  it('keeps the quote for the two models, and keeps them going out with it', async () => {
    const form = await shipped('withdrawal_form')

    const unticked = await change(form.id, { kinds: ['order_confirmation'] }).expect(400)

    expect((unticked.body as { message: string }).message).toBe(
      'Die Belehrung „Muster-Widerrufsformular“ gehört zu jedem Angebot an einen Verbraucher, ' +
        'deshalb lässt sich das Angebot hier nicht abwählen.',
    )

    const kept = await change(form.id, { withDocument: false }).expect(400)

    expect((kept.body as { message: string }).message).toContain('zwingend mit dem Angebot')

    const widened = await change(form.id, { kinds: ['quote', 'order_confirmation'] }).expect(200)

    expect(widened.body).toMatchObject({ kinds: ['quote', 'order_confirmation'] })

    await change(form.id, { kinds: ['quote'] }).expect(200)
  })
})

describe('an instruction of the business', () => {
  it('is written, listed after the shipped ones, changed and removed', async () => {
    const created = await http()
      .post('/settings/instructions')
      .set('x-test-identity', owner())
      .send({
        title: '  Hinweise zur Wartung  ',
        body: 'Bitte lassen Sie die Anlage jährlich prüfen.\nIhr {name}',
        kinds: ['final_invoice'],
      })
      .expect(201)

    const own = created.body as InstructionView

    expect(own).toMatchObject({
      template: null,
      title: 'Hinweise zur Wartung',
      changed: false,
      model: null,
      kinds: ['final_invoice'],
      consumersOnly: false,
      withDocument: true,
    })
    expect((await list()).at(-1)?.id).toBe(own.id)

    const renamed = await change(own.id, { title: 'Wartung' }).expect(200)

    expect(renamed.body).toMatchObject({ title: 'Wartung' })

    await http()
      .post(`/settings/instructions/${own.id}/restore`)
      .set('x-test-identity', owner())
      .expect(409)
    await http()
      .delete(`/settings/instructions/${own.id}`)
      .set('x-test-identity', owner())
      .expect(200)

    expect((await list()).map((entry) => entry.id)).not.toContain(own.id)
  })

  it('needs a heading and words', async () => {
    await http()
      .post('/settings/instructions')
      .set('x-test-identity', owner())
      .send({ title: 'Leer', body: '  \n ' })
      .expect(400)
    await http()
      .post('/settings/instructions')
      .set('x-test-identity', owner())
      .send({ body: 'Ohne Überschrift.' })
      .expect(400)
  })

  it('is never without words, not even written past the route', async () => {
    await expect(
      admin.query("insert into instructions (tenant_id, title) values ($1, 'Leer')", [north.id]),
    ).rejects.toThrow(/instructions_words/)
  })
})

describe('a shipped instruction', () => {
  it('cannot be removed, only proposed for nothing', async () => {
    const early = await shipped('early_start')
    const refused = await http()
      .delete(`/settings/instructions/${early.id}`)
      .set('x-test-identity', owner())
      .expect(409)

    expect((refused.body as { message: string }).message).toContain('zu keinem Beleg mehr vor')

    const unused = await change(early.id, { kinds: [] }).expect(200)

    expect(unused.body).toMatchObject({ kinds: [] })
  })
})
