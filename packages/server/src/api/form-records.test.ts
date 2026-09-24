import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
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
import { ApiModule } from './api.module.js'
import { binary } from './test-binary.js'
import { as, testIdentities as identities } from './test-identity.js'
import { boardOf, changed, created, installationOf, push } from './test-structure.js'

/**
 * The test protocol after DIN VDE 0100-600 (#79) over the form engine of #78:
 * filled at an installation through the outbox, checked against its
 * definition on the way in, fixed once the tester has signed, and printed
 * with every value, its verdict and the source of each limit.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let installationId: string
let circuitId: string

const jobs: PrintJob[] = []

const standIn: Renderer = (job) => {
  jobs.push(job)

  return Promise.resolve(new TextEncoder().encode('%PDF-1.7 Probedruck'))
}

const technician = () => as(north.id, 'technician')

/** The circuit as the blocks of the protocol keep it: F1, B16 behind 30 mA. */
const kitchen = {
  designation: 'F1',
  consumer: 'Steckdosen Küche',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
}

const signature = {
  name: 'Paul Prüfer',
  path: 'M10,10L200,120L400,80',
  signedAt: '2026-09-24T10:00:00.000Z',
}

/** Everything the protocol needs before it can be signed, as the record carries it. */
function complete(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tester: 'Paul Prüfer',
    occasion: 'new',
    earthing_system: 'tn_s',
    basic_protection: 'ok',
    protective_devices: 'ok',
    conductors: 'ok',
    identification: 'ok',
    fire_protection: 'ok',
    documentation: 'ok',
    rcd_test_button: 'ok',
    switchgear: 'ok',
    verdict: 'passed',
    circuits: [
      {
        circuitId,
        circuit: kitchen,
        values: {
          protective_conductor: 120,
          // 0,85 MΩ, below the 1,0 MΩ of Tabelle 6.1.
          insulation_resistance: 850,
          loop_impedance: 780,
          rcd_trip_current: 24_000,
          rcd_trip_time: 23_000,
        },
      },
    ],
    ...over,
  })
}

function protocol(recordId: string, values: string) {
  return created('form_records', recordId, {
    definitionKey: 'vde-0100-600',
    definitionVersion: 1,
    installationId,
    performedOn: '2026-09-24',
    status: 'draft',
    values,
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { renderer: standIn })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  installationId = await installationOf(app, north.id)

  const { boardId, sectionId } = await boardOf(app, north.id, installationId)

  circuitId = newId<'circuit'>()
  await push(app, as(north.id, 'office'), [
    created('circuits', circuitId, {
      distributionBoardId: boardId,
      boardSectionId: sectionId,
      designation: 'F1',
      consumer: 'Steckdosen Küche',
      overcurrentDevice: 'circuit_breaker',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      rcdType: 'a',
      ratedResidualCurrentMilli: 30,
      position: 0,
    }),
  ])
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a test protocol through the outbox', () => {
  it('is filled at an installation on site, measured values kept as measured', async () => {
    const id = newId<'form-record'>()
    const { receipts } = await push(app, technician(), [protocol(id, complete())])

    expect(receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const { rows } = await admin.query<{ status: string; values: string }>(
      'select status, values from form_records where id = $1',
      [id],
    )

    expect(rows[0]?.status).toBe('draft')
    // The text as the device wrote it, character for character, so that the
    // next change finds in `from` what it saw. The 0,85 MΩ below the limit
    // stays: what was measured is what goes on paper.
    expect(rows[0]?.values).toBe(complete())
  })

  it('is refused with the sentence for a value its definition does not know', async () => {
    const refused = await push(
      app,
      technician(),
      [
        protocol(
          newId<'form-record'>(),
          JSON.stringify({ tester: 'Paul Prüfer', weather: 'Regen' }),
        ),
      ],
      400,
    )

    expect(refused.message).toBe(
      'Das Feld weather gibt es in Prüfprotokoll Erstprüfung nach DIN VDE 0100-600 nicht.',
    )
  })

  it('is refused for a definition this version does not know', async () => {
    const refused = await push(
      app,
      technician(),
      [
        created('form_records', newId<'form-record'>(), {
          definitionKey: 'vde-0100-600',
          definitionVersion: 99,
          installationId,
          performedOn: '2026-09-24',
          status: 'draft',
          values: '{}',
        }),
      ],
      400,
    )

    expect(refused.message).toBe('Dieses Formular kennt diese Fassung von OpenGewerk nicht.')
  })

  it('is signed only complete, and changes no more once it is', async () => {
    const id = newId<'form-record'>()

    await push(app, technician(), [protocol(id, complete({ verdict: undefined }))])

    const early = await push(
      app,
      technician(),
      [
        changed('form_records', id, {
          status: { from: 'draft', to: 'signed' },
          values: {
            from: complete({ verdict: undefined }),
            to: complete({ verdict: undefined, tester_signature: signature }),
          },
        }),
      ],
      400,
    )

    expect(early.message).toBe('Unterschrieben wird ein vollständiges Protokoll: Ergebnis fehlt.')

    const { receipts } = await push(app, technician(), [
      changed('form_records', id, {
        status: { from: 'draft', to: 'signed' },
        values: {
          from: complete({ verdict: undefined }),
          to: complete({ tester_signature: signature }),
        },
      }),
    ])

    expect(receipts[0]?.outcome).toBe('applied')

    const after = await push(app, technician(), [
      changed('form_records', id, { performedOn: { from: '2026-09-24', to: '2026-09-25' } }),
    ])

    expect(after.receipts[0]).toMatchObject({ outcome: 'conflict', reason: 'record_is_fixed' })

    // And for every other way in.
    const refusal = await refusedBy(
      admin.query("update form_records set performed_on = '2026-09-25' where id = $1", [id]),
    )

    expect(refusal.code).toBe('OG001')
  })
})

describe('a test protocol on paper', () => {
  it('prints every value with its verdict, the limits with their sources and the signature', async () => {
    const id = newId<'form-record'>()

    await push(app, technician(), [
      protocol(id, complete()),
      changed('form_records', id, {
        status: { from: 'draft', to: 'signed' },
        values: { from: complete(), to: complete({ tester_signature: signature }) },
      }),
    ])

    await http()
      .get(`/form-records/${id}/pdf`)
      .set('x-test-identity', as(north.id, 'office'))
      .buffer(true)
      .parse(binary)
      .expect(200)

    const job = jobs.at(-1)
    const html = job?.html ?? ''

    expect(job?.landscape).toBe(true)
    expect(html).toContain('<h1>Prüfprotokoll Erstprüfung nach DIN VDE 0100-600</h1>')
    expect(html).toContain('Steckdosen Küche')
    expect(html).toMatch(/<td class="figure outside">0,85 !<\/td>/)
    expect(html).toMatch(/<td class="figure">0,78<\/td>/)
    expect(html).toContain('DIN VDE 0100-600 (VDE 0100-600):2017-06, Tabelle 6.1')
    expect(html).toContain('<svg class="signature-picture"')
    expect(html).not.toContain('Entwurf')
  })

  it('says it is a draft while nobody has signed it', async () => {
    const id = newId<'form-record'>()

    await push(app, technician(), [protocol(id, JSON.stringify({ tester: 'Paul Prüfer' }))])
    await http()
      .get(`/form-records/${id}/pdf`)
      .set('x-test-identity', as(north.id, 'office'))
      .buffer(true)
      .parse(binary)
      .expect(200)

    expect(jobs.at(-1)?.html).toContain('Entwurf, noch nicht unterschrieben')
  })

  it('is not found for a record that is not there', async () => {
    await http()
      .get(`/form-records/${newId<'form-record'>()}/pdf`)
      .set('x-test-identity', as(north.id, 'office'))
      .expect(404)
  })
})

function http() {
  return request(app.getHttpServer())
}
