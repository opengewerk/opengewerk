import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { signedContentFingerprint, type TenantId } from '@opengewerk/domain'
import { Database, FileStore, newId, type Renderer } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'
import { created, push } from './test-structure.js'

/**
 * The on-call service (#293): the on-call plan kept in the office, the service
 * call made on call with the narrow right and only in a time of the plan, and
 * the surcharge the invoice out of the report of an emergency call carries.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }

let admin: Pool
let database: Database
let app: INestApplication
let storageRoot = ''

const standIn: Renderer = () => Promise.resolve(new TextEncoder().encode('%PDF-1.7'))
const office = () => as(north.id, 'office')
const owner = () => as(north.id, 'owner')
const jonas = () => JSON.stringify({ userId: 'jonas', tenantId: north.id, roles: ['technician'] })
const scribble = 'M100,300L200,120L300,280'

/** Wednesday 28.10.2026, 02:14 in Germany. */
const atNight = '2026-10-28T01:14:00.000Z'
/** The same Wednesday at 10:00. */
const inTheDay = '2026-10-28T09:00:00.000Z'

function http() {
  return request(app.getHttpServer())
}

async function post(path: string, body: Record<string, unknown>, who = office(), status = 201) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(status)

  return answer.body as { id: string; message?: string }
}

function aCall(fields: Record<string, unknown> = {}) {
  const id = newId<'job'>()

  return {
    id,
    operation: created('jobs', id, {
      customerId: customer,
      kind: 'service',
      status: 'active',
      designation: 'Heizung ohne Strom',
      emergencyAt: atNight,
      ...fields,
    }),
  }
}

async function aSignedReport(jobId: string) {
  const report = (
    await post('/documents', {
      customerId: customer,
      jobId,
      kind: 'time_and_material_report',
      documentDate: '2026-10-28',
    })
  ).id

  await post(`/documents/${report}/lines`, {
    designation: 'Arbeitszeit',
    quantityMilli: 1000,
    unit: 'hour',
    unitPriceCents: 0,
  })

  const { rows } = await admin.query<{
    id: string
    position: number
    designation: string
    quantity_milli: string
  }>('select id, position, designation, quantity_milli from document_lines where document_id = $1', [
    report,
  ])
  const sent = await push(app, office(), [
    created('document_signatures', newId<'document-signature'>(), {
      documentId: report,
      signerName: 'Ayse Arslan',
      signedAt: new Date().toISOString(),
      deviceInfo: null,
      path: scribble,
      contentFingerprint: signedContentFingerprint({
        introText: null,
        lines: rows.map((row) => ({
          id: row.id,
          position: row.position,
          kind: 'item',
          designation: row.designation,
          description: null,
          quantityMilli: Number(row.quantity_milli),
          unit: 'hour',
        })),
      }),
    }),
  ])

  expect(sent.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

  return report
}

async function linesOf(documentId: string) {
  const { rows } = await admin.query<{ designation: string; unit_price_cents: number; unit: string }>(
    'select designation, unit_price_cents, unit from document_lines where document_id = $1 order by position',
    [documentId],
  )

  return rows
}

async function setting(key: string, value: number) {
  await post('/settings/parameters', { key, from: '2026-01-01', value, note: null }, owner())
}

let customer = ''
let shift = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [north.id, north.name])
  await readyToInvoice(admin, north.id)
  await admin.query(
    "insert into auth_users (id, name, email) values ('jonas', 'Jonas Brandt', 'jonas@nord.example.de'), ('lena', 'Lena Hoffmann', 'lena@nord.example.de')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'jonas', '{technician}'), ($1, 'lena', '{technician}')",
    [north.id],
  )

  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-on-call-'))
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

  customer = (await post('/customers', { kind: 'private', name: 'Familie Arslan', ...invoiceable })).id
  shift = (
    await post('/on-call-shifts', {
      userId: 'jonas',
      startsAt: '2026-10-26T16:00:00.000Z',
      endsAt: '2026-11-02T06:00:00.000Z',
      note: 'Woche 44',
    })
  ).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('the on-call plan (#293)', () => {
  it('is kept in the office and listed by the span it overlaps', async () => {
    const answer = await http()
      .get('/on-call-shifts?from=2026-10-28T00:00:00.000Z&to=2026-10-29T00:00:00.000Z')
      .set('x-test-identity', jonas())
      .expect(200)

    expect(answer.body).toMatchObject([{ id: shift, userId: 'jonas', note: 'Woche 44' }])
  })

  it('is not kept by a technician', async () => {
    await post(
      '/on-call-shifts',
      { userId: 'jonas', startsAt: '2026-11-10T16:00:00.000Z', endsAt: '2026-11-11T06:00:00.000Z' },
      jonas(),
      403,
    )
  })

  it('takes only somebody who works here, and an end after the beginning', async () => {
    const stranger = await post(
      '/on-call-shifts',
      { userId: 'niemand', startsAt: '2026-11-10T16:00:00.000Z', endsAt: '2026-11-11T06:00:00.000Z' },
      office(),
      422,
    )

    expect(stranger.message).toContain('wer im Betrieb arbeitet')

    const backwards = await post(
      '/on-call-shifts',
      { userId: 'jonas', startsAt: '2026-11-11T16:00:00.000Z', endsAt: '2026-11-11T06:00:00.000Z' },
      office(),
      422,
    )

    expect(backwards.message).toContain('nach ihrem Beginn')
  })

  it('swaps the people of two times, and the times stay', async () => {
    const later = (
      await post('/on-call-shifts', {
        userId: 'lena',
        startsAt: '2026-11-09T16:00:00.000Z',
        endsAt: '2026-11-16T06:00:00.000Z',
      })
    ).id

    await post(`/on-call-shifts/${later}/swap`, { with: shift })

    const { rows } = await admin.query<{ id: string; user_id: string }>(
      'select id, user_id from on_call_shifts where id = any($1) order by starts_at',
      [[shift, later]],
    )

    expect(rows).toEqual([
      { id: shift, user_id: 'lena' },
      { id: later, user_id: 'jonas' },
    ])

    // And back, for the tests below.
    await post(`/on-call-shifts/${shift}/swap`, { with: later })
    await http().delete(`/on-call-shifts/${later}`).set('x-test-identity', office()).expect(200)
  })
})

describe('a service call made on call', () => {
  it('lands from the technician on call, with the moment of the call', async () => {
    const call = aCall()
    const sent = await push(app, jonas(), [call.operation])

    expect(sent.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const { rows } = await admin.query('select kind, emergency_at from jobs where id = $1', [call.id])

    expect(rows).toEqual([{ kind: 'service', emergency_at: new Date(atNight) }])
  })

  it('is refused as a conflict outside every time of the plan of that person', async () => {
    const sent = await push(app, jonas(), [aCall({ emergencyAt: '2026-10-20T01:00:00.000Z' }).operation])

    expect(sent.receipts.map((receipt) => [receipt.outcome, receipt.reason, receipt.fields])).toEqual([
      ['conflict', 'record_is_fixed', ['emergencyAt']],
    ])
  })

  it('is refused without the moment of the call, and with one ahead of the clock', async () => {
    const without = await push(app, jonas(), [aCall({ emergencyAt: null }).operation])
    const ahead = await push(app, jonas(), [
      aCall({ emergencyAt: new Date(Date.now() + 3_600_000).toISOString() }).operation,
    ])

    expect([...without.receipts, ...ahead.receipts].map((receipt) => receipt.outcome)).toEqual([
      'conflict',
      'conflict',
    ])
  })

  it('is no project: that takes the right to write jobs', async () => {
    const refused = await push(app, jonas(), [aCall({ kind: 'project' }).operation], 400)

    expect(refused.message).toContain('darf dieser Zugang nicht')
  })

  it('is made by the office at any time, without a time of the plan', async () => {
    const sent = await push(app, office(), [aCall({ emergencyAt: inTheDay }).operation])

    expect(sent.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
  })
})

describe('the surcharge of an emergency call', () => {
  it('is the last line of the invoice out of its report, for the kind of the call', async () => {
    await setting('emergency.night_flat_cents', 4500)

    const call = aCall()

    await push(app, jonas(), [call.operation])

    const report = await aSignedReport(call.id)
    const invoice = (await post(`/documents/${report}/successors`, { kind: 'final_invoice' })).id

    expect((await linesOf(invoice)).at(-1)).toEqual({
      designation: 'Notdienstzuschlag Nacht',
      unit_price_cents: 4500,
      unit: 'flat_rate',
    })
  })

  it('is no line for a call in ordinary hours, nor for a job that is no emergency', async () => {
    const day = aCall({ emergencyAt: inTheDay })

    await push(app, office(), [day.operation])

    const ordinary = await post('/jobs', { customerId: customer, kind: 'service', designation: 'Steckdose' })
    const fromTheDay = (
      await post(`/documents/${await aSignedReport(day.id)}/successors`, { kind: 'final_invoice' })
    ).id
    const fromOrdinary = (
      await post(`/documents/${await aSignedReport(ordinary.id)}/successors`, { kind: 'final_invoice' })
    ).id

    expect((await linesOf(fromTheDay)).map((line) => line.designation)).toEqual(['Arbeitszeit'])
    expect((await linesOf(fromOrdinary)).map((line) => line.designation)).toEqual(['Arbeitszeit'])
  })

  it('comes once on the collective invoice of the call', async () => {
    const call = aCall()

    await push(app, jonas(), [call.operation])

    for (let day = 0; day < 2; day += 1) {
      const report = await aSignedReport(call.id)

      await post(`/documents/${report}/issue`, {})
    }

    const invoice = (await post(`/jobs/${call.id}/collective-invoice`, {})).id
    const designations = (await linesOf(invoice)).map((line) => line.designation)

    expect(designations.filter((one) => one === 'Arbeitszeit')).toHaveLength(2)
    expect(designations.filter((one) => one === 'Notdienstzuschlag Nacht')).toHaveLength(1)
    expect(designations.at(-1)).toBe('Notdienstzuschlag Nacht')
  })
})
