import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { DocumentContent } from '@opengewerk/domain'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import type { PrintJob, Renderer } from '../documents/renderer.js'
import { ApiModule } from './api.module.js'
import type { DocumentInstructionsView } from './document-instructions.controller.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, oneLine, readyToInvoice } from './test-invoice.js'

/**
 * The instructions of a document, #109: proposed by its kind and customer,
 * switched on and off by the office, filled in for the kind of contract,
 * refused at issuing when the letterhead lacks what they name, frozen with
 * the document, printed after it in its PDF and each as a sheet of its own.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let consumer: string
let business: string

const jobs: PrintJob[] = []

const standIn: Renderer = async (job) => {
  jobs.push(job)

  return new TextEncoder().encode(`%PDF-1.7 Probedruck ${String(jobs.length)}`)
}

const office = () => as(north.id, 'office')
const owner = () => as(north.id, 'owner')
const neighbour = () => as(south.id, 'office')

function http() {
  return request(app.getHttpServer())
}

async function quote(customerId = consumer, fields: Record<string, unknown> = {}) {
  const created = await http()
    .post('/documents')
    .set('x-test-identity', office())
    .send({ customerId, kind: 'quote', documentDate: '2026-09-22', ...fields })
    .expect(201)
  const id = (created.body as { id: string }).id

  await http()
    .post(`/documents/${id}/lines`)
    .set('x-test-identity', office())
    .send(oneLine)
    .expect(201)

  return id
}

async function instructionsOf(documentId: string, identity = office()) {
  const answer = await http()
    .get(`/documents/${documentId}/instructions`)
    .set('x-test-identity', identity)
    .expect(200)

  return answer.body as DocumentInstructionsView
}

function choose(documentId: string, body: Record<string, unknown>, identity = office()) {
  return http()
    .put(`/documents/${documentId}/instructions`)
    .set('x-test-identity', identity)
    .send(body)
}

function issue(documentId: string) {
  return http().post(`/documents/${documentId}/issue`).set('x-test-identity', office())
}

async function snapshotOf(documentId: string): Promise<DocumentContent> {
  const { rows } = await admin.query<{ content: DocumentContent }>(
    'select content from document_snapshots where document_id = $1',
    [documentId],
  )

  if (!rows[0]) {
    throw new Error('No snapshot.')
  }

  return rows[0].content
}

async function idOf(documentId: string, title: string) {
  const found = (await instructionsOf(documentId)).choices.find((entry) => entry.title === title)

  if (!found) {
    throw new Error(`No ${title}.`)
  }

  return found.id
}

function pdf(path: string, identity = office()) {
  return http().get(path).set('x-test-identity', identity).buffer(true).parse(binary)
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
  await readyToInvoice(admin, north.id)

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const private_ = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'private', name: 'Familie Berg', ...invoiceable })
    .expect(201)
  consumer = (private_.body as { id: string }).id

  const company = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'business', name: 'Hausverwaltung Kai', isBusiness: true, ...invoiceable })
    .expect(201)
  business = (company.body as { id: string }).id
})

beforeEach(() => {
  jobs.length = 0
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the instructions of a quote to a consumer', () => {
  it('are proposed: the instruction on withdrawal and its form go out with it, the sheet stays', async () => {
    const view = await instructionsOf(await quote())

    expect(view).toMatchObject({ fixed: false, variant: 'service', gaps: [] })
    expect(
      view.choices.map((entry) => [
        entry.title,
        entry.proposed,
        entry.included,
        entry.withDocument,
      ]),
    ).toEqual([
      ['Widerrufsbelehrung', true, true, true],
      ['Muster-Widerrufsformular', true, true, true],
      ['Beginn vor Ablauf der Widerrufsfrist', true, true, false],
    ])
    expect(view.printed.map((entry) => entry.index)).toEqual([0, 1, 2])
    expect(view.printed[0]?.source).toContain('Anlage 1 zu Art. 246a')
  })

  it('are not proposed for a customer who is a business', async () => {
    const view = await instructionsOf(await quote(business))

    expect(view.choices.every((entry) => !entry.proposed && !entry.included)).toBe(true)
    expect(view.printed).toEqual([])
  })

  it('are frozen with the quote, filled in from the letterhead', async () => {
    const id = await quote()

    await issue(id).expect(201)

    const content = await snapshotOf(id)

    expect(content.instructions.map((entry) => entry.title)).toEqual([
      'Widerrufsbelehrung',
      'Muster-Widerrufsformular',
      'Beginn vor Ablauf der Widerrufsfrist',
    ])
    expect(content.instructions[0]).toMatchObject({
      withDocument: true,
      variant: 'service',
      model: { template: 'withdrawal', validFrom: '2026-06-19', changed: false },
    })
    expect(content.instructions[0]?.text).toContain(
      '(Elektro Nord GmbH, Hafenstraße 12, 20457 Hamburg, Telefon 040 123456, E-Mail ' +
        'info@nord.example.de)',
    )
    expect(content.instructions[0]?.text).toContain('ab dem Tag des Vertragsabschlusses.')

    const view = await instructionsOf(id)

    expect(view).toMatchObject({ fixed: true, choices: [] })
    expect(view.printed.map((entry) => entry.title)).toEqual(
      content.instructions.map((entry) => entry.title),
    )
  })

  it('keep their words once issued, whatever the business changes afterwards', async () => {
    const id = await quote()
    await issue(id).expect(201)

    const withdrawal = (
      (await http().get('/settings/instructions').set('x-test-identity', owner()).expect(200))
        .body as { id: string; template: string }[]
    ).find((entry) => entry.template === 'withdrawal')

    await http()
      .patch(`/settings/instructions/${withdrawal?.id ?? ''}`)
      .set('x-test-identity', owner())
      .send({ body: 'Später geändert.' })
      .expect(200)

    expect((await snapshotOf(id)).instructions[0]?.text).toContain('Sie haben das Recht')

    await pdf(`/documents/${id}/instructions/0/pdf`).expect(200)

    expect(jobs.at(-1)?.html).toContain('Sie haben das Recht')
    expect(jobs.at(-1)?.html).not.toContain('Später geändert.')

    await http()
      .post(`/settings/instructions/${withdrawal?.id ?? ''}/restore`)
      .set('x-test-identity', owner())
      .expect(201)
  })
})

describe('the choice on a document', () => {
  it('switches a proposed instruction off, and keeps no choice once it matches the proposal', async () => {
    const id = await quote()
    const early = await idOf(id, 'Beginn vor Ablauf der Widerrufsfrist')

    const off = await choose(id, { instructionId: early, included: false }).expect(200)

    expect((off.body as DocumentInstructionsView).printed.map((entry) => entry.title)).toEqual([
      'Widerrufsbelehrung',
      'Muster-Widerrufsformular',
    ])

    await choose(id, { instructionId: early, included: true }).expect(200)

    const { rows } = await admin.query<{ switched_on: string[]; switched_off: string[] }>(
      'select switched_on, switched_off from document_instruction_choices where document_id = $1',
      [id],
    )

    expect(rows[0]).toEqual({ switched_on: [], switched_off: [] })
  })

  it('switches on one that is not proposed, for a business as well', async () => {
    const id = await quote(business)
    const form = await idOf(id, 'Muster-Widerrufsformular')

    const on = await choose(id, { instructionId: form, included: true }).expect(200)

    expect((on.body as DocumentInstructionsView).printed.map((entry) => entry.title)).toEqual([
      'Muster-Widerrufsformular',
    ])
  })

  it('fills the instruction in for a delivery with installation, and passes that on', async () => {
    const id = await quote()

    await choose(id, { variant: 'goods' }).expect(200)
    await issue(id).expect(201)

    const content = await snapshotOf(id)

    expect(content.instructions[0]?.variant).toBe('goods')
    expect(content.instructions[0]?.text).toContain('Wir holen die Waren ab.')

    const successor = await http()
      .post(`/documents/${id}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'order_confirmation' })
      .expect(201)

    expect((await instructionsOf((successor.body as { id: string }).id)).variant).toBe('goods')
  })

  it('is refused for a document that was issued, and for what is not a choice', async () => {
    const id = await quote()

    await choose(id, { variant: 'rental' }).expect(400)
    await choose(id, { instructionId: 'x', included: 'ja' }).expect(400)
    await choose(id, {}).expect(400)
    await choose(id, { instructionId: newId<'instruction'>(), included: true }).expect(404)

    await issue(id).expect(201)

    const refused = await choose(id, { variant: 'goods' }).expect(409)

    expect((refused.body as { message: string }).message).toContain('festgeschrieben')
  })

  it('is out of reach of another business', async () => {
    const id = await quote()

    await http()
      .get(`/documents/${id}/instructions`)
      .set('x-test-identity', neighbour())
      .expect(404)
    await choose(id, { variant: 'goods' }, neighbour()).expect(404)
  })
})

describe('a letterhead that lacks what an instruction names', () => {
  it('shows on the draft and stops the issuing, until the instruction is switched off', async () => {
    await admin.query('update letterheads set phone = null where tenant_id = $1', [north.id])

    try {
      const id = await quote()
      const view = await instructionsOf(id)

      expect(view.gaps).toEqual([
        'Für die Belehrung „Widerrufsbelehrung“ fehlt im Briefkopf die Telefonnummer des ' +
          'Betriebs. Eintragen lässt sich das unter „Einstellungen“, „Briefkopf“. Gehört die ' +
          'Belehrung nicht zu diesem Beleg, lässt sie sich am Beleg unter „Belehrungen“ abschalten.',
      ])

      const refused = await issue(id).expect(422)

      expect((refused.body as { message: string }).message).toContain(
        'Für die Belehrung „Widerrufsbelehrung“ fehlt im Briefkopf die Telefonnummer',
      )

      await choose(id, {
        instructionId: await idOf(id, 'Widerrufsbelehrung'),
        included: false,
      }).expect(200)
      await issue(id).expect(201)

      expect((await snapshotOf(id)).instructions.map((entry) => entry.title)).toEqual([
        'Muster-Widerrufsformular',
        'Beginn vor Ablauf der Widerrufsfrist',
      ])
    } finally {
      await admin.query("update letterheads set phone = '040 123456' where tenant_id = $1", [
        north.id,
      ])
    }
  })
})

describe('the instructions on paper', () => {
  it('follow the quote in its PDF, the ones that go with it, each on a page of its own', async () => {
    const id = await quote()

    await pdf(`/documents/${id}/pdf`).expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(html).toContain('<section class="instruction">')
    expect(html).toContain('Anlage zu Angebot vom 22.09.2026')
    expect(html).toContain('<h2>Widerrufsbelehrung</h2>')
    expect(html).toContain('<h2>Muster-Widerrufsformular</h2>')
    expect(html).toContain('<div class="write-line"></div>')
    expect(html).not.toContain('Beginn vor Ablauf der Widerrufsfrist')
  })

  it('come one by one as a sheet, the one kept at the document first of all', async () => {
    const id = await quote()

    await issue(id).expect(201)

    const sheet = await pdf(`/documents/${id}/instructions/2/pdf`).expect(200)
    const html = jobs.at(-1)?.html ?? ''

    expect(sheet.headers['content-disposition']).toContain(
      encodeURIComponent('Beginn vor Ablauf der Widerrufsfrist zu Angebot'),
    )
    expect(html).toContain('<h1>Beginn vor Ablauf der Widerrufsfrist</h1>')
    expect(html).toMatch(/Zu Angebot AN-\S+ vom 22\.09\.2026/)
    expect(html).toContain('per E-Mail an info@nord.example.de')
    expect(html).not.toContain('ENTWURF')

    await pdf(`/documents/${id}/instructions/7/pdf`).expect(404)
    await pdf(`/documents/${id}/instructions/zwei/pdf`).expect(404)
  })
})
