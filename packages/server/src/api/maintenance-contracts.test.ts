import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { addDays, addMonths, berlinClock, type DocumentId, type TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * Maintenance contracts (#294): made out of an issued quote, one per quote,
 * with the installations of its site; read at customer, site and
 * installation; ended by a notice with the term it was in time for. Each
 * maintenance makes one service job, once per day, and the invoice out of
 * its report carries the flat price of the contract.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId
const today = berlinClock(new Date()).day

let admin: Pool
let database: Database
let app: INestApplication

const office = (tenant: TenantId = north) => as(tenant, 'office')
const technician = (tenant: TenantId = north) => as(tenant, 'technician')

let customer = ''
let site = ''
let otherSite = ''
let meter = ''
let lights = ''
let elsewhere = ''
let southern = ''
let quotes: DocumentId[] = []

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

async function quote(
  tenant: TenantId = north,
  status: 'issued' | 'draft' = 'issued',
  kind = 'quote',
): Promise<DocumentId> {
  const id = newId<'document'>() as DocumentId
  const customerOf =
    tenant === north
      ? customer
      : (
          await admin.query<{ id: string }>('select id from customers where tenant_id = $1', [
            south,
          ])
        ).rows[0]?.id

  await admin.query(
    `insert into documents (id, tenant_id, customer_id, site_id, kind, status, number, document_date, issued_at, issued_by, subject)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Wartung')`,
    [
      id,
      tenant,
      customerOf,
      tenant === north ? site : null,
      kind,
      status,
      status === 'issued' ? `AN-${String(quotes.length + 1)}` : null,
      today,
      status === 'issued' ? new Date() : null,
      status === 'issued' ? 'britta' : null,
    ],
  )
  quotes.push(id)

  return id
}

/** A contract every half year from ten days on, two years, renewing for a year, three months notice, 480 € a time. */
function terms(overrides: Record<string, unknown> = {}) {
  return {
    designation: 'Wartung Elektroanlage Rheinstraße 12',
    services: 'Sichtprüfung der Verteiler\nAuslöseprüfung der Fehlerstrom-Schutzeinrichtungen',
    installationIds: [meter],
    startsOn: today,
    firstVisitOn: addDays(today, 10),
    intervalMonths: 6,
    termMonths: 24,
    renewal: 'fixed',
    renewalMonths: 12,
    noticeMonths: 3,
    priceKind: 'flat',
    flatCents: 48_000,
    ...overrides,
  }
}

async function contract(overrides: Record<string, unknown> = {}, quoteId?: DocumentId) {
  const answer = await http()
    .post('/maintenance-contracts')
    .set('x-test-identity', office())
    .send({ quoteId: quoteId ?? (await quote()), ...terms(overrides) })
    .expect(201)

  return answer.body as Record<string, unknown> & { id: string }
}

async function deadlinesOf(contractId: string, kind: string) {
  const { rows } = await admin.query<{ due_on: string; status: string; source_label: string }>(
    `select to_char(due_on, 'YYYY-MM-DD') as due_on, status, source_label from deadlines where source_id = $1 and kind = $2`,
    [contractId, kind],
  )

  return rows
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north,
    'Elektro Nord GmbH',
    south,
    'Elektro Süd GmbH',
  ])

  customer = newId<'customer'>()
  site = newId<'site'>()
  otherSite = newId<'site'>()
  await admin.query(
    `insert into customers (id, tenant_id, kind, name) values ($1, $2, 'business', 'Hausverwaltung Süd GmbH'),
       ($3, $4, 'business', 'Metzgerei Lang GmbH')`,
    [customer, north, newId<'customer'>(), south],
  )
  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation) values ($1, $3, $4, 'Rheinstraße 12'), ($2, $3, $4, 'Lindenhof')`,
    [site, otherSite, north, customer],
  )

  const installation = async (tenant: TenantId, siteId: string, designation: string) => {
    const id = newId<'installation'>()

    await admin.query(
      `insert into installations (id, tenant_id, site_id, kind, designation) values ($1, $2, $3, 'meter_cabinet', $4)`,
      [id, tenant, siteId, designation],
    )

    return id
  }

  meter = await installation(north, site, 'Zählerschrank, Keller')
  lights = await installation(north, site, 'Treppenhausbeleuchtung')
  elsewhere = await installation(north, otherSite, 'Zählerschrank Lindenhof')

  const southSite = newId<'site'>()
  const southCustomer = (
    await admin.query<{ id: string }>('select id from customers where tenant_id = $1', [south])
  ).rows[0]?.id
  await admin.query(
    `insert into sites (id, tenant_id, customer_id, designation) values ($1, $2, $3, 'Hauptstraße 20')`,
    [southSite, south, southCustomer],
  )
  southern = await installation(south, southSite, 'Kühlraum')

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query('delete from deadlines')
  await admin.query('delete from tasks')
  await admin.query(
    'begin; set local session_replication_role = replica; delete from document_lines; delete from documents where kind <> $$quote$$; delete from jobs; delete from maintenance_contracts; commit;',
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a maintenance contract out of a quote (#294)', () => {
  it('is made out of an issued quote, with its customer, its site and a number of its own', async () => {
    const made = await contract()

    expect(made).toMatchObject({
      customerId: customer,
      siteId: site,
      installationIds: [meter],
      renewal: 'fixed',
      paymentRhythm: 'visit',
      cancelledOn: null,
      endsOn: null,
    })
    expect(String(made['number'])).toMatch(/^WV-\d{4}-0001$/)
  })

  it('is refused out of a draft, out of an estimate and a second time out of the same quote', async () => {
    for (const source of [
      await quote(north, 'draft'),
      await quote(north, 'issued', 'cost_estimate'),
    ]) {
      const answer = await http()
        .post('/maintenance-contracts')
        .set('x-test-identity', office())
        .send({ quoteId: source, ...terms() })
        .expect(422)

      expect(refusal(answer)).toBe(
        'Ein Wartungsvertrag entsteht aus einem festgeschriebenen Angebot.',
      )
    }

    const once = await quote()
    const first = await contract({}, once)
    const again = await http()
      .post('/maintenance-contracts')
      .set('x-test-identity', office())
      .send({ quoteId: once, ...terms() })
      .expect(409)

    expect(refusal(again)).toBe(
      `Aus diesem Angebot ist schon der Wartungsvertrag ${String(first['number'])} entstanden.`,
    )
  })

  it('takes the installations of its site and no other, of this business or another', async () => {
    for (const foreign of [elsewhere, southern]) {
      const answer = await http()
        .post('/maintenance-contracts')
        .set('x-test-identity', office())
        .send({ quoteId: await quote(), ...terms({ installationIds: [meter, foreign] }) })
        .expect(422)

      expect(refusal(answer)).toBe('Die Anlagen eines Vertrags sind die seines Objekts.')
    }

    const made = await contract({ installationIds: [meter, lights] })

    await http()
      .patch(`/maintenance-contracts/${made.id}`)
      .set('x-test-identity', office())
      .send({ installationIds: [elsewhere] })
      .expect(422)
  })

  it('is made and changed by whoever issues documents, and not by a technician', async () => {
    await http()
      .post('/maintenance-contracts')
      .set('x-test-identity', technician())
      .send({ quoteId: await quote(), ...terms() })
      .expect(403)

    const made = await contract()

    await http()
      .patch(`/maintenance-contracts/${made.id}`)
      .set('x-test-identity', technician())
      .send({ designation: 'Anders' })
      .expect(403)
  })

  it('stays with its business', async () => {
    const made = await contract()

    await http()
      .get(`/maintenance-contracts/${made.id}`)
      .set('x-test-identity', office(south))
      .expect(404)

    const listed = await http()
      .get('/maintenance-contracts')
      .set('x-test-identity', office(south))
      .expect(200)

    expect(listed.body).toEqual([])
  })

  it('is listed at its customer, its site and each of its installations', async () => {
    const made = await contract({ installationIds: [meter, lights] })
    await contract({ installationIds: [] })

    const ids = async (query: string) =>
      (
        (
          await http()
            .get(`/maintenance-contracts?${query}`)
            .set('x-test-identity', office())
            .expect(200)
        ).body as { id: string }[]
      ).map((row) => row.id)

    expect(await ids(`customerId=${customer}`)).toHaveLength(2)
    expect(await ids(`siteId=${site}`)).toHaveLength(2)
    expect(await ids(`installationId=${lights}`)).toEqual([made.id])
    expect(await ids(`installationId=${elsewhere}`)).toEqual([])
  })

  it('checks its terms as a whole', async () => {
    const refused = async (overrides: Record<string, unknown>) =>
      refusal(
        await http()
          .post('/maintenance-contracts')
          .set('x-test-identity', office())
          .send({ quoteId: await quote(), ...terms(overrides) })
          .expect(422),
      )

    expect(await refused({ renewalMonths: null })).toBe(
      'Die Verlängerung sind ganze Monate, 1 bis 60.',
    )
    expect(await refused({ flatCents: null })).toBe(
      'Die Pauschale ist ein Betrag in Euro, höchstens 100.000,00 €.',
    )
    expect(await refused({ firstVisitOn: addDays(today, -1) })).toBe(
      'Die erste Wartung liegt nicht vor dem Beginn.',
    )

    const made = await contract()
    const changed = await http()
      .patch(`/maintenance-contracts/${made.id}`)
      .set('x-test-identity', office())
      .send({ renewal: 'indefinite', priceKind: 'effort' })
      .expect(200)

    expect(changed.body).toMatchObject({ renewalMonths: null, flatCents: null })
  })

  it('ends after a notice with the term it was in time for, and runs on once the notice is taken back', async () => {
    const made = await contract()
    const lastDayForNotice = addDays(addMonths(today, 21), -1)
    const firstEnd = addDays(addMonths(today, 24), -1)

    const inTime = await http()
      .post(`/maintenance-contracts/${made.id}/notice`)
      .set('x-test-identity', office())
      .send({ receivedOn: lastDayForNotice })
      .expect(201)

    expect(inTime.body).toMatchObject({ cancelledOn: lastDayForNotice, endsOn: firstEnd })

    await http()
      .post(`/maintenance-contracts/${made.id}/notice`)
      .set('x-test-identity', office())
      .send({ receivedOn: today })
      .expect(409)

    await http()
      .delete(`/maintenance-contracts/${made.id}/notice`)
      .set('x-test-identity', office())
      .expect(200)

    const late = await http()
      .post(`/maintenance-contracts/${made.id}/notice`)
      .set('x-test-identity', office())
      .send({ receivedOn: addDays(lastDayForNotice, 1) })
      .expect(201)

    expect(late.body).toMatchObject({ endsOn: addDays(addMonths(today, 36), -1) })
  })
})

describe('the maintenances of a contract (#294)', () => {
  it('make one service job per day with the contract, the day, the installation and the services, and move on', async () => {
    const made = await contract()
    const first = addDays(today, 10)

    await runDeadlinesOf({ database }, north, new Date())
    await runDeadlinesOf({ database }, north, new Date())

    const { rows } = await admin.query<{
      kind: string
      designation: string
      description: string
      installation_id: string
      due: string
      number: string | null
    }>(
      `select kind, designation, description, installation_id, to_char(maintenance_due_on, 'YYYY-MM-DD') as due, number
         from jobs where maintenance_contract_id = $1`,
      [made.id],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'service',
      designation: 'Wartung Elektroanlage Rheinstraße 12',
      installation_id: meter,
      due: first,
    })
    expect(rows[0]?.number).not.toBeNull()
    expect(rows[0]?.description).toContain('- Auslöseprüfung der Fehlerstrom-Schutzeinrichtungen')
    expect(await deadlinesOf(made.id, 'maintenance.visit')).toEqual([
      expect.objectContaining({ due_on: addMonths(first, 6), status: 'open' }),
    ])

    await http()
      .delete(`/maintenance-contracts/${made.id}`)
      .set('x-test-identity', office())
      .expect(409)
  })

  it('stop after the day a notice ends the contract', async () => {
    const running = await contract({
      termMonths: 1,
      noticeMonths: 0,
      firstVisitOn: addDays(today, 40),
    })
    const ended = await contract({
      termMonths: 1,
      noticeMonths: 0,
      firstVisitOn: addDays(today, 40),
    })

    await http()
      .post(`/maintenance-contracts/${ended.id}/notice`)
      .set('x-test-identity', office())
      .send({ receivedOn: today })
      .expect(201)
    await runDeadlinesOf({ database }, north, new Date())

    expect(await deadlinesOf(running.id, 'maintenance.visit')).toHaveLength(1)
    expect(await deadlinesOf(ended.id, 'maintenance.visit')).toEqual([])

    await http()
      .delete(`/maintenance-contracts/${ended.id}`)
      .set('x-test-identity', office())
      .expect(200)
  })

  it('remind of the last day a notice ends the term, and not once notice was given', async () => {
    const startsOn = addMonths(addDays(today, 10), -11)
    const made = await contract({
      startsOn,
      firstVisitOn: addDays(today, 200),
      termMonths: 12,
      noticeMonths: 1,
    })
    const given = await contract({ startsOn, firstVisitOn: addDays(today, 200), termMonths: 12 })

    await http()
      .post(`/maintenance-contracts/${given.id}/notice`)
      .set('x-test-identity', office())
      .send({ receivedOn: today })
      .expect(201)
    await runDeadlinesOf({ database }, north, new Date())

    expect(await deadlinesOf(made.id, 'maintenance.notice')).toEqual([
      expect.objectContaining({
        due_on: addDays(today, 9),
        source_label: `${String(made['number'])} Wartung Elektroanlage Rheinstraße 12`,
      }),
    ])
    expect(await deadlinesOf(given.id, 'maintenance.notice')).toEqual([])
  })
})

describe('the invoice out of the report of a maintenance (#294)', () => {
  async function reportOf(contractId: string): Promise<string> {
    await runDeadlinesOf({ database }, north, new Date())

    const { rows } = await admin.query<{ id: string }>(
      'select id from jobs where maintenance_contract_id = $1',
      [contractId],
    )
    const report = newId<'document'>()
    // A signed report keeps its lines; written past the triggers, as a device
    // would have sent them before the signature.
    const client = await admin.connect()

    try {
      await client.query('begin')
      await client.query('set local session_replication_role = replica')
      await client.query(
        `insert into documents (id, tenant_id, customer_id, site_id, job_id, kind, status, document_date, subject)
         values ($1, $2, $3, $4, $5, 'time_and_material_report', 'signed', $6, 'Wartung')`,
        [report, north, customer, site, rows[0]?.id, today],
      )
      await client.query(
        `insert into document_lines (tenant_id, document_id, kind, position, designation, quantity_milli, unit, unit_price_cents, vat_rate, net_cents)
         values ($1, $2, 'item', 1, 'Arbeitszeit Monteur', 2000, 'hour', 0, 'standard', 0)`,
        [north, report],
      )
      await client.query('commit')
    } finally {
      client.release()
    }

    return report
  }

  async function linesOfInvoiceOut(report: string) {
    const invoice = await http()
      .post(`/documents/${report}/successors`)
      .set('x-test-identity', office())
      .send({ kind: 'final_invoice' })
      .expect(201)
    const { rows } = await admin.query<{
      designation: string
      unit: string
      unit_price_cents: number | null
    }>(
      'select designation, unit, unit_price_cents from document_lines where document_id = $1 order by position',
      [(invoice.body as { id: string }).id],
    )

    return rows
  }

  it('carries the flat price of the contract as its one line', async () => {
    const made = await contract()

    expect(await linesOfInvoiceOut(await reportOf(made.id))).toEqual([
      {
        designation: 'Wartung Elektroanlage Rheinstraße 12',
        unit: 'flat_rate',
        unit_price_cents: 48_000,
      },
    ])
  })

  it('comes out of the report as usual for a contract at effort', async () => {
    const made = await contract({ priceKind: 'effort', flatCents: null })

    expect(await linesOfInvoiceOut(await reportOf(made.id))).toEqual([
      expect.objectContaining({ designation: 'Arbeitszeit Monteur', unit: 'hour' }),
    ])
  })
})
