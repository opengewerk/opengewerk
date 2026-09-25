import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type DocumentContent,
  formValuesText,
  type FormDefinition,
  type ReportField,
  signedContentFingerprint,
} from '@opengewerk/domain'
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
  refusedBy,
  resetSchema,
} from '../database/test-database.js'
import type { PrintJob, Renderer } from '../documents/renderer.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'

/**
 * The fields a business gives its reports (#78): written under "Einstellungen"
 * as versions that are never changed, filled in on site through the outbox,
 * part of what the customer signs, frozen with the report and printed.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot: string
let customerId: string

const jobs: PrintJob[] = []

const standIn: Renderer = (job) => {
  jobs.push(job)

  return Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))
}

const owner = () => as(north.id, 'owner')
const office = () => as(north.id, 'office')
const technician = () => as(north.id, 'technician')

const scribble = 'M100,300L200,120L300,280L400,100'

const weather: ReportField = {
  kind: 'choice',
  key: 'field_1',
  label: 'Wetter',
  options: [
    { value: 'dry', label: 'trocken' },
    { value: 'rain', label: 'Regen' },
  ],
}

const distance: ReportField = {
  kind: 'number',
  key: 'field_2',
  label: 'Anfahrt',
  unit: 'kilometre',
  decimals: 0,
}

type Values = Record<string, string | number | boolean | null>

function creating(entity: string, recordId: string, values: Values) {
  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'create',
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date().toISOString(),
  }
}

function http() {
  return request(app.getHttpServer())
}

async function push(operations: unknown[], expected = 201, who = technician()) {
  const answer = await http()
    .post('/sync')
    .set('x-test-identity', who)
    .send({ deviceId: 'geraet-im-keller', operations })
    .expect(expected)

  return answer.body as { receipts: { outcome: string; reason: string | null }[]; message?: string }
}

async function saveFields(fields: readonly ReportField[], who = owner(), expected = 200) {
  const answer = await http()
    .put('/settings/report-fields')
    .set('x-test-identity', who)
    .send({ fields })
    .expect(expected)

  return answer.body as { definition: FormDefinition; message?: string }
}

/** A report as the device writes it, with the fields of the version it names. */
function report(id: string, values: Values) {
  return creating('documents', id, {
    customerId,
    kind: 'time_and_material_report',
    documentDate: '2026-09-24',
    introText: 'Zwei Leitungsschutzschalter getauscht.',
    ...values,
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)

  // An issued document keeps its PDF in the file store on the first request.
  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-felder-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, identities, {
        files: new FileStore(storageRoot),
        renderer: standIn,
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const customer = await http()
    .post('/customers')
    .set('x-test-identity', office())
    .send({ kind: 'private', name: 'Familie Berg', ...invoiceable })
    .expect(201)

  customerId = (customer.body as { id: string }).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the fields of the reports in the settings', () => {
  it('start with none, are saved as versions, and the same fields again are no new one', async () => {
    const none = await http()
      .get('/settings/report-fields')
      .set('x-test-identity', office())
      .expect(200)

    expect(none.body).toEqual({ definition: null })

    const first = await saveFields([weather])
    const again = await saveFields([{ ...weather, label: '  Wetter ' }])
    const second = await saveFields([weather, distance])

    expect(first.definition.version).toBe(1)
    expect(again.definition.version).toBe(1)
    expect(second.definition).toMatchObject({
      key: 'report',
      version: 2,
      attachesTo: 'document',
      sections: [{ fields: [weather, distance] }],
    })

    const { rows } = await admin.query<{ definition_version: number }>(
      'select definition_version from form_definitions order by definition_version',
    )

    expect(rows.map((row) => row.definition_version)).toEqual([1, 2])
  })

  it('are refused in a kind a report does not take, and saved by the owner alone', async () => {
    const refused = await saveFields(
      [{ kind: 'photo', key: 'field_3', label: 'Foto' } as never],
      owner(),
      400,
    )

    expect(refused.message).toBe('Ein Feld ist Text, Zahl mit Einheit, Auswahl oder Ja/Nein.')
    // Like every setting: the office reads them, the owner writes them.
    await saveFields([weather], office(), 403)
    await saveFields([weather], technician(), 403)
  })

  it('reach every device through the sync, and are changed on none', async () => {
    const pulled = await http()
      .get('/sync?since=0')
      .set('x-test-identity', technician())
      .expect(200)
    const changes = (pulled.body as { changes: { entity: string; rows: unknown[] }[] }).changes
    const definitions = changes.find((change) => change.entity === 'form_definitions')

    expect(definitions?.rows).toHaveLength(2)

    // The client queues none; one that sends one anyway is answered about that
    // operation: the owner, who may write the settings, is sent to the
    // settings, and anybody else lacks the right.
    const written = () =>
      creating('form_definitions', newId<'form-definition'>(), {
        key: 'report',
        definitionVersion: 3,
        definition: '{}',
      })
    const { receipts } = await push([written()], 201, owner())
    const refused = await push([written()], 400)

    expect(receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'online_only' })
    expect((refused as { message?: string }).message).toBe(
      'Einstellungen ändern darf dieser Zugang nicht. Der Inhaber vergibt die Rollen unter „Zugänge“.',
    )
  })

  it('stay as they were written, whoever asks to change them', async () => {
    const refusal = await refusedBy(
      admin.query("update form_definitions set definition = '{}' where definition_version = 1"),
    )

    expect(refusal.code).toBe('OG001')
  })
})

describe('the fields of a report', () => {
  it('are filled in on site in the version the report names', async () => {
    const id = newId<'document'>()
    const { receipts } = await push([
      report(id, {
        fieldsVersion: 2,
        fieldValues: formValuesText({ field_1: 'rain', field_2: 25_000 }),
      }),
    ])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
  })

  it('are refused for a version the business never wrote, values that do not fit, and any other kind', async () => {
    const unknown = await push(
      [report(newId<'document'>(), { fieldsVersion: 9, fieldValues: '{}' })],
      400,
    )
    const wrong = await push(
      [
        report(newId<'document'>(), {
          fieldsVersion: 2,
          fieldValues: formValuesText({ field_2: 'weit' }),
        }),
      ],
      400,
    )
    const quote = await push(
      [
        creating('documents', newId<'document'>(), {
          customerId,
          kind: 'quote',
          documentDate: '2026-09-24',
          fieldsVersion: 2,
          fieldValues: '{}',
        }),
      ],
      400,
    )

    expect(unknown.message).toBe(
      'Diese Fassung der Felder des Regieberichts gibt es in diesem Betrieb nicht.',
    )
    expect(wrong.message).toBe('Anfahrt: eine Zahl.')
    expect(quote.message).toBe('Nur ein Regiebericht trägt die Felder des Betriebs.')
  })

  it('are part of what the customer signs, frozen with the report and printed', async () => {
    const id = newId<'document'>()
    const fieldValues = formValuesText({ field_1: 'rain', field_2: 25_000 })
    const introText = 'Zwei Leitungsschutzschalter getauscht.'

    await push([report(id, { fieldsVersion: 2, fieldValues })])

    const signature = (fields: string | null) =>
      creating('document_signatures', newId<'document-signature'>(), {
        documentId: id,
        signerName: 'Erika Berg',
        signedAt: '2026-09-24T12:32:00.000Z',
        deviceInfo: 'Mozilla/5.0',
        path: scribble,
        contentFingerprint: signedContentFingerprint({ introText, lines: [], fields }),
      })

    // Signed on a page without the fields, it is about another page.
    const blind = await push([signature(null)])

    expect(blind.receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'changed_elsewhere' })

    const signed = await push([signature(fieldValues)])

    expect(signed.receipts[0]?.outcome).toBe('applied')

    await http().post(`/documents/${id}/issue`).set('x-test-identity', owner()).expect(201)

    const { rows } = await admin.query<{ content: DocumentContent }>(
      'select content from document_snapshots where document_id = $1',
      [id],
    )

    expect(rows[0]?.content.reportFields).toEqual([
      { label: 'Wetter', text: 'Regen' },
      { label: 'Anfahrt', text: '25 km' },
    ])

    await http()
      .get(`/documents/${id}/pdf`)
      .set('x-test-identity', office())
      .buffer(true)
      .parse(binary)
      .expect(200)

    const html = jobs.at(-1)?.html ?? ''

    expect(html).toContain('<table class="report-fields">')
    expect(html).toContain('<tr><th>Anfahrt</th><td>25 km</td></tr>')
  })
})
