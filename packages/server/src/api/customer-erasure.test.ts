import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  addMonths,
  berlinClock,
  type IsoDate,
  syncEntities,
  type TenantId,
} from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { restrictedOut } from '../database/device-scope.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { documentToCustomer } from '../notifications/notify.js'
import { ApiModule } from './api.module.js'
import { invoiceable, readyToInvoice } from './test-invoice.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * Customers under the deletion concept (#845): a request for deletion from
 * the request to its end, a customer restricted while documents or a
 * warranty hold it, and one deleted with everything that hangs on it once
 * nothing does. What a deletion leaves is the site with its installations
 * (#848) and empty rows the rest of the business points at.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

function person(userId: string, roles: string[], tenantId: TenantId = north) {
  return JSON.stringify({ userId, tenantId, roles })
}

const owner = person('lena', ['owner'])
const office = person('bruno', ['office'])
const technician = person('tom', ['technician'])

const today = berlinClock(new Date()).day

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

/** The message of whatever a statement of the application threw, the database's included. */
async function refusedWith(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause

    return String(cause?.message ?? (error as Error).message)
  }

  return 'went through'
}

/** A statement of the application role, in the business of the north as a person. */
function asApplication(statement: string, userId = 'lena') {
  return database.forTenant({ tenantId: north, userId }, (tx) => tx.execute(sql.raw(statement)))
}

interface Fixture {
  /** The family name of this one, unlike every other test's. */
  readonly family: string
  readonly customer: string
  readonly site: string
  readonly job: string
  readonly invoice: string
  readonly report: string
  readonly attachment: string
  readonly installation: string
}

const hex = (letter: string) => letter.repeat(64)

/**
 * A customer of 2019 with something in every table a deletion reaches, its
 * name and address in each: Ingrid Vossberg, Quittenweg, Vossdorf. Its last
 * invoice is of 2017 and its last report of 2018, so that nothing is kept
 * any more; whatever a test needs to hold it, it adds.
 */
async function vossberg(): Promise<Fixture> {
  const family = `Vossberg${newId<'customer'>().slice(-6)}`
  const customer = newId<'customer'>()
  const site = newId<'site'>()
  const job = newId<'job'>()
  const invoice = newId<'document'>()
  const report = newId<'document'>()
  const attachment = newId<'attachment'>()
  const installation = newId<'installation'>()
  const access = newId<'site-access'>()
  const request = newId<'early-start-request'>()
  const pdf = newId<'file'>()

  await admin.query(
    `begin;
     set local app.user_id = 'bruno';
     insert into customers (id, tenant_id, kind, name, email, phone, street, house_number, postal_code, city, notes, created_at)
       values ('${customer}', '${north}', 'private', 'Ingrid ${family}', 'ingrid@${family.toLowerCase()}.example', '040 111 222',
               'Quitten${family}', '3', '21111', 'Dorf${family}', 'Frau ${family} mag keine Anrufe', '2019-02-01');
     insert into sites (id, tenant_id, customer_id, designation, street, house_number, city, notes)
       values ('${site}', '${north}', '${customer}', 'Quitten${family} 3', 'Quitten${family}', '3', 'Dorf${family}', 'Hund der ${family}s im Garten');
     insert into installations (id, tenant_id, site_id, kind, designation)
       values ('${installation}', '${north}', '${site}', 'meter_cabinet', 'Zählerschrank Keller');
     insert into contacts (tenant_id, customer_id, given_name, family_name, email)
       values ('${north}', '${customer}', 'Ingrid', '${family}', 'ingrid@${family.toLowerCase()}.example');
     insert into contacts (tenant_id, site_id, given_name, family_name, phone)
       values ('${north}', '${site}', 'Kurt', '${family}', '040 333');
     insert into communications (tenant_id, customer_id, kind, text, happened_at)
       values ('${north}', '${customer}', 'note', 'Rückruf bei ${family} wegen Angebot', '2019-03-01');
     insert into prospects (tenant_id, name, source, last_contact_on, customer_id, site_id, converted_at)
       values ('${north}', 'Ingrid ${family}', 'referral', '2019-01-15', '${customer}', '${site}', '2019-02-01');
     insert into jobs (id, tenant_id, customer_id, site_id, kind, status, designation, description, created_at, closed_at)
       values ('${job}', '${north}', '${customer}', '${site}', 'project', 'completed', 'Küche ${family}',
               'Bei ${family} die Küche', '2019-03-01', '2019-05-01');
     insert into job_notes (tenant_id, job_id, text, written_at)
       values ('${north}', '${job}', 'Frau ${family} öffnet', '2019-04-01');
     insert into appointments (tenant_id, job_id, starts_at, ends_at, note)
       values ('${north}', '${job}', '2019-04-01 08:00+02', '2019-04-01 12:00+02', 'Bei ${family} klingeln');
     insert into tasks (tenant_id, title, notes, due_on, assignee_user_id, customer_id)
       values ('${north}', '${family} anrufen', 'Wegen der Küche ${family}', '2019-04-02', 'bruno', '${customer}');
     insert into site_accesses (id, tenant_id, site_id, designation, hint)
       values ('${access}', '${north}', '${site}', 'Schlüssel ${family}', 'unter der Matte');
     insert into secrets (tenant_id, purpose, sealed, record_id)
       values ('${north}', 'site_access', 'versiegelt', '${access}');
     insert into documents (id, tenant_id, customer_id, job_id, kind, status, number, document_date, subject, intro_text)
       values ('${invoice}', '${north}', '${customer}', '${job}', 'final_invoice', 'draft', 'RE-2017-0001', '2017-06-01',
               'Rechnung ${family}', 'Sehr geehrte Frau ${family}');
     insert into document_lines (tenant_id, document_id, position, designation, quantity_milli, unit, unit_price_cents, net_cents)
       values ('${north}', '${invoice}', 1, 'Steckdose bei ${family}', 1000, 'piece', 2400, 2400);
     update documents set status = 'issued' where id = '${invoice}';
     insert into documents (id, tenant_id, customer_id, job_id, kind, status, document_date, subject)
       values ('${report}', '${north}', '${customer}', '${job}', 'time_and_material_report', 'draft', '2018-02-01',
               'Bericht ${family}');
     insert into document_snapshots (tenant_id, document_id, content)
       values ('${north}', '${invoice}', '{"recipient": "Ingrid ${family}, Quitten${family} 3"}');
     insert into files (id, tenant_id, sha256, size_bytes, media_type)
       values ('${pdf}', '${north}', '${hex('a')}', 10, 'application/pdf'),
              (default, '${north}', '${hex('b')}', 10, 'image/jpeg');
     insert into document_files (tenant_id, document_id, purpose, file_id)
       values ('${north}', '${invoice}', 'pdf', '${pdf}');
     insert into payments (tenant_id, document_id, amount_cents, received_on)
       values ('${north}', '${invoice}', 2856, '2017-06-20');
     insert into attachments (id, tenant_id, customer_id, title)
       values ('${attachment}', '${north}', '${customer}', 'Foto bei ${family}');
     insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
       values ('${north}', '${attachment}', '${hex('b')}', '${family.toLowerCase()}.jpg', 'image/jpeg', 10);
     insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, recipient_name, subject, body, document_id)
       values ('${north}', 'document', 'document:${invoice}', 'Elektro Nord', 'ingrid@${family.toLowerCase()}.example', 'Ingrid ${family}',
               'Ihre Rechnung', 'Hallo Frau ${family}', '${invoice}');
     commit;`,
  )
  // Closed in 2019; the trigger that stamps the day a job closes knows only today.
  await admin.query(
    `begin; set local session_replication_role = replica;
     update jobs set closed_at = '2019-05-01' where id = '${job}'; commit;`,
  )
  // Signed on the device in 2018; what the trigger of the signature does is
  // not the subject here.
  await admin.query(
    `begin; set local session_replication_role = replica;
     insert into early_start_requests (id, tenant_id, job_id, signer_name, signed_at, path, content_fingerprint)
       values ('${request}', '${north}', '${job}', 'Ingrid ${family}', '2019-03-02', 'M1,1L2,2', '${hex('c')}');
     insert into document_signatures (tenant_id, document_id, signer_name, signed_at, path, content_fingerprint)
       values ('${north}', '${report}', 'Ingrid ${family}', '2018-02-01', 'M1,1L2,2', '${hex('d')}');
     update documents set status = 'signed' where id = '${report}';
     commit;`,
  )

  return { family, customer, site, job, invoice, report, attachment, installation }
}

/**
 * Every place the name, the mail or the street of the customer still stands,
 * by table and column, but for the street of the site, which stays (#848).
 */
async function tracesOf(family: string): Promise<string[]> {
  const { rows } = await admin.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type in ('text', 'jsonb', 'character varying')
        and table_name in (select tablename from pg_tables where schemaname = 'public')`,
  )
  const found: string[] = []

  for (const row of rows) {
    const hit = await admin.query(
      `select 1 from "${row.table_name}" where "${row.column_name}"::text ~* $1 limit 1`,
      [family],
    )

    if (hit.rowCount === 1) {
      found.push(`${row.table_name}.${row.column_name}`)
    }
  }

  return found.sort()
}

function record(customer: string, values: Record<string, unknown> = {}, who = office) {
  return http()
    .post('/privacy/requests')
    .set('x-test-identity', who)
    .send({ customerId: customer, receivedOn: today, channel: 'email', ...values })
}

interface RequestView {
  request: {
    id: string
    status: string
    answerDueOn: string
    receivedOn: string
    createdBy: string
  }
  customerName: string
  holds: { kind: string; until: string | null }[]
  answer: string | null
  dueOn: string | null
}

function erase(customer: string, who = owner) {
  return http()
    .post('/privacy/erasures')
    .set('x-test-identity', who)
    .send({ kind: 'customer', ids: [customer] })
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
  await admin.query(
    `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor) values
       ($1, 'owner', 'Inhaber', '{}', true, false), ($1, 'office', 'Büro', '{}', false, false),
       ($1, 'technician', 'Monteur', '{}', false, false), ($2, 'owner', 'Inhaber', '{}', true, false)`,
    [north, south],
  )
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('lena', 'Lena Leitung', 'lena@example.de'), ('bruno', 'Bruno Büro', 'bruno@example.de'),
       ('tom', 'Tom Technik', 'tom@example.de'), ('sven', 'Sven Süd', 'sven@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'lena', '{owner}'), ($1, 'bruno', '{office}'), ($1, 'tom', '{technician}'),
       ($2, 'sven', '{owner}')`,
    [north, south],
  )

  await readyToInvoice(admin, north)

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from audit_redactions; delete from erasures; delete from erasure_requests;
     delete from erasure_automations; delete from mail_outbox; delete from deadlines; delete from tasks;
     delete from payments; delete from document_files; delete from document_snapshots;
     delete from document_signatures; delete from document_lines; delete from documents;
     delete from attachment_versions; delete from attachments; delete from files;
     delete from early_start_requests; delete from job_notes; delete from appointments; delete from jobs;
     delete from communications; delete from prospects; delete from secrets; delete from site_accesses;
     delete from contacts; delete from installations; delete from sites; delete from customers;
     delete from deadline_settings; commit;`,
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a request for deletion (#845)', () => {
  it('is recorded by whoever may change customers, its answer due a month later', async () => {
    const { customer, family } = await vossberg()
    const answer = await record(customer, { receivedOn: '2026-10-31', channel: 'letter' }).expect(
      201,
    )
    const view = answer.body as RequestView

    expect(view.request).toMatchObject({
      status: 'open',
      receivedOn: '2026-10-31',
      answerDueOn: '2026-11-30',
      createdBy: 'bruno',
    })
    expect(view.customerName).toBe(`Ingrid ${family}`)
    expect(view.answer).toBe('erase')

    await record(customer, {}, technician).expect(403)
  })

  it('runs one at a time per customer, and comes neither from the future nor for nobody', async () => {
    const { customer } = await vossberg()

    await record(customer).expect(201)
    expect(refusal(await record(customer).expect(409))).toBe(
      'Für diesen Kunden läuft schon eine Löschanfrage.',
    )
    expect(refusal(await record(customer, { receivedOn: '2999-01-01' }).expect(422))).toContain(
      'Zukunft',
    )
    await record(newId<'customer'>()).expect(404)
  })

  it('is proposed for an answer by a deadline that names nobody', async () => {
    const { customer } = await vossberg()

    await record(customer, { receivedOn: today })
    await runDeadlinesOf({ database }, north, new Date())

    const { rows } = await admin.query<{
      source_label: string
      due_on: string
      customer_id: string
    }>(
      "select source_label, due_on::text, customer_id from deadlines where kind = 'privacy.erasure_request'",
    )

    expect(rows).toEqual([
      {
        source_label: `Löschanfrage vom ${today.slice(8, 10)}.${today.slice(5, 7)}.${today.slice(0, 4)}`,
        due_on: addMonths(today as IsoDate, 1),
        customer_id: customer,
      },
    ])
  })

  it('moves only forwards, and is done only with the deletion of its customer', async () => {
    const { customer } = await vossberg()
    const view = (await record(customer).expect(201)).body as RequestView

    expect(
      await refusedWith(
        asApplication(
          `update erasure_requests set status = 'erased', erased_at = now() where id = '${view.request.id}'`,
        ),
      ),
    ).toContain('erledigt ist sie erst mit dem Löschen ihres Kunden')
    // Somebody who does not lead finds no request to answer.
    await asApplication(
      `update erasure_requests set status = 'restricted', restricted_at = now() where id = '${view.request.id}'`,
      'bruno',
    )
    expect(
      (await admin.query('select status from erasure_requests where id = $1', [view.request.id]))
        .rows,
    ).toEqual([{ status: 'open' }])
  })
})

describe('restricting a customer (#845)', () => {
  it('is the answer while documents still have to be kept, and only for whoever leads', async () => {
    const { customer } = await vossberg()

    await admin.query(
      `insert into documents (tenant_id, customer_id, kind, status, number, document_date)
       values ($1, $2, 'final_invoice', 'issued', 'RE-2026-0009', $3)`,
      [north, customer, today],
    )

    const view = (await record(customer).expect(201)).body as RequestView
    const year = Number(today.slice(0, 4))

    expect(view.answer).toBe('restrict')
    expect(view.holds).toEqual([{ kind: 'retention', until: `${String(year + 8)}-12-31` }])
    expect(view.dueOn).toBe(`${String(year + 9)}-01-01`)

    await http()
      .post(`/privacy/requests/${view.request.id}/restriction`)
      .set('x-test-identity', office)
      .expect(403)

    const restricted = await http()
      .post(`/privacy/requests/${view.request.id}/restriction`)
      .set('x-test-identity', owner)
      .expect(201)

    expect((restricted.body as RequestView).request.status).toBe('restricted')
  })

  it('is refused while nothing holds the customer or a job is still open', async () => {
    const { customer, job } = await vossberg()
    const view = (await record(customer).expect(201)).body as RequestView

    expect(
      refusal(
        await http()
          .post(`/privacy/requests/${view.request.id}/restriction`)
          .set('x-test-identity', owner)
          .expect(409),
      ),
    ).toContain('gelöscht, nicht gesperrt')

    await admin.query("update jobs set status = 'active' where id = $1", [job])

    expect(
      refusal(
        await http()
          .post(`/privacy/requests/${view.request.id}/restriction`)
          .set('x-test-identity', owner)
          .expect(409),
      ),
    ).toContain('Auftrag offen')
  })

  it('takes the customer and what hangs on it off every device and out of the list', async () => {
    const { customer, site, invoice, installation } = await vossberg()

    await admin.query(
      `insert into documents (tenant_id, customer_id, kind, status, number, document_date)
       values ($1, $2, 'final_invoice', 'issued', 'RE-2026-0010', $3)`,
      [north, customer, today],
    )

    const before = await http().get('/sync?since=0').set('x-test-identity', owner).expect(200)
    const view = (await record(customer).expect(201)).body as RequestView

    await http()
      .post(`/privacy/requests/${view.request.id}/restriction`)
      .set('x-test-identity', owner)
      .expect(201)

    const after = await http().get('/sync?since=0').set('x-test-identity', owner).expect(200)
    const held = (answer: { body: unknown }, entity: string) =>
      (answer.body as { changes: { entity: string; rows: { id: string }[] }[] }).changes
        .filter((change) => change.entity === entity)
        .flatMap((change) => change.rows.map((row) => row.id))
    const narrowed = (answer: { body: unknown }) =>
      (answer.body as { narrowed: Record<string, string> }).narrowed

    expect(held(before, 'customers')).toContain(customer)
    expect(held(after, 'customers')).not.toContain(customer)
    expect(held(after, 'sites')).not.toContain(site)
    expect(held(after, 'documents')).not.toContain(invoice)
    expect(held(after, 'installations')).not.toContain(installation)
    expect(narrowed(after)['customers']).not.toBe(narrowed(before)['customers'])
    expect(narrowed(after)['on_call_shifts']).toBe(narrowed(before)['on_call_shifts'])

    const listed = await http().get('/customers').set('x-test-identity', owner).expect(200)

    expect((listed.body as { id: string }[]).map((entry) => entry.id)).not.toContain(customer)
  })

  it('narrows every entity a device holds that hangs on a customer', async () => {
    // A column that ties a row to a customer, directly or through what
    // belongs to one; a table a device holds with such a column is either
    // narrowed by a restriction or says here why not (security review of #849).
    const keys = [
      'customer_id',
      'site_id',
      'job_id',
      'document_id',
      'source_document_id',
      'installation_id',
      'appliance_id',
      'defect_id',
      'appointment_id',
      'attachment_id',
      'distribution_board_id',
      'circuit_id',
      'inverter_id',
      'pv_string_id',
      'form_record_id',
    ]
    const { rows } = await admin.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
        where table_schema = 'public' and column_name = any($1)`,
      [keys],
    )
    const held = new Set<string>(syncEntities)
    const restricted = { customerIds: [newId<'customer'>()], value: 'restricted:x' }
    const left = rows
      .map((row) => row.table_name)
      .filter((table) => held.has(table) && restrictedOut(restricted, table) === undefined)
      .sort()

    // Two hold no more of a customer than the key of a job, whose row stays
    // off the device: the bookings of a vehicle's stock (#298), and the
    // working time of the staff, which is theirs and goes with #846.
    expect(left).toEqual(['stock_movements', 'time_entries'])
  })

  it('sends the customer no mail any more', async () => {
    // Two customers with an invoice issued the way the office issues one: the
    // one free gets its mail, which shows that the way works, the one
    // restricted gets none.
    const invoiceOf = async (name: string) => {
      const customer = (
        (
          await http()
            .post('/customers')
            .set('x-test-identity', office)
            .send({ kind: 'private', name, ...invoiceable, email: 'post@example.org' })
            .expect(201)
        ).body as { id: string }
      ).id
      const document = (
        (
          await http()
            .post('/documents')
            .set('x-test-identity', office)
            .send({
              customerId: customer,
              kind: 'final_invoice',
              documentDate: today,
              serviceFrom: today,
              serviceUntil: today,
            })
            .expect(201)
        ).body as { id: string }
      ).id

      await http()
        .post(`/documents/${document}/lines`)
        .set('x-test-identity', office)
        .send({
          designation: 'Steckdose',
          quantityMilli: 1000,
          unit: 'piece',
          unitPriceCents: 2400,
        })
        .expect(201)
      await http().post(`/documents/${document}/issue`).set('x-test-identity', owner).expect(201)

      return { customer, document }
    }
    const mailFor = (documentId: string) =>
      documentToCustomer(database, north, {
        kind: 'document',
        documentId,
        request: 'office',
        to: { address: 'post@example.org', name: 'Kunde' },
        attachment: 'pdf',
        requestedBy: 'lena',
      } as never)
    const free = await invoiceOf('Kai Frei')
    const held = await invoiceOf('Ute Gehalten')
    const view = (await record(held.customer).expect(201)).body as RequestView

    await http()
      .post(`/privacy/requests/${view.request.id}/restriction`)
      .set('x-test-identity', owner)
      .expect(201)

    expect(await mailFor(free.document)).toHaveLength(1)
    expect(await mailFor(held.document)).toEqual([])
  })
})

describe('what is due (#845)', () => {
  it('is a customer with whom nothing runs, three years after its last contact', async () => {
    const { customer, family } = await vossberg()

    await runDeadlinesOf({ database }, north, new Date())

    const { rows } = await admin.query<{ source_label: string; due_on: string }>(
      "select source_label, due_on::text from deadlines where kind = 'privacy.customer_erasure' and source_id = $1",
      [customer],
    )

    // The last contact is the job closed in May 2019.
    expect(rows).toEqual([
      { source_label: 'Privatkunde, letzter Kontakt 01.05.2019', due_on: '2022-05-01' },
    ])

    const seen = await http().get('/privacy').set('x-test-identity', office).expect(200)

    expect((seen.body as { due: { recordId: string; name: string }[] }).due).toEqual([
      expect.objectContaining({ recordId: customer, name: `Ingrid ${family}` }),
    ])
  })

  it('is no customer with a job open, nor before its documents and its warranty let it go', async () => {
    const { customer, job } = await vossberg()

    await admin.query("update jobs set status = 'active' where id = $1", [job])
    await runDeadlinesOf({ database }, north, new Date())

    expect(
      (
        await admin.query(
          "select 1 from deadlines where kind = 'privacy.customer_erasure' and status = 'open'",
        )
      ).rowCount,
    ).toBe(0)

    await admin.query("update jobs set status = 'completed' where id = $1", [job])
    await admin.query(
      `insert into documents (tenant_id, customer_id, kind, status, number, document_date)
       values ($1, $2, 'quote', 'issued', 'AN-2024-0001', '2024-05-01')`,
      [north, customer],
    )
    await runDeadlinesOf({ database }, north, new Date())

    // Not before the day: the list of deadlines holds no customer years ahead.
    expect(
      (
        await admin.query(
          "select 1 from deadlines where kind = 'privacy.customer_erasure' and status = 'open'",
        )
      ).rowCount,
    ).toBe(0)

    // A quote is a business letter, kept six years from the end of 2024.
    const view = (await record(customer).expect(201)).body as RequestView

    expect(view.holds).toEqual([{ kind: 'retention', until: '2030-12-31' }])
    expect(view.dueOn).toBe('2031-01-01')
  })

  it('moves with the months the business sets', async () => {
    const { customer } = await vossberg()

    await admin.query(
      `insert into deadline_settings (tenant_id, kind, interval_months)
       values ($1, 'privacy.customer_erasure', 12)`,
      [north],
    )
    await runDeadlinesOf({ database }, north, new Date())

    const { rows } = await admin.query<{ due_on: string }>(
      "select due_on::text from deadlines where kind = 'privacy.customer_erasure' and source_id = $1",
      [customer],
    )

    expect(rows).toEqual([{ due_on: '2020-05-01' }])
  })
})

describe('deleting a customer (#845)', () => {
  it('empties it and everything of it, keeps the site, and leaves its name nowhere', async () => {
    const { family, customer, site, job, invoice, report, installation } = await vossberg()

    await record(customer).expect(201)

    const answer = await erase(customer).expect(201)

    expect(answer.body).toEqual([
      expect.objectContaining({
        kind: 'customer',
        label: expect.stringMatching(/^Privatkunde auf Löschanfrage vom /) as unknown,
        erasedBy: 'lena',
        automatic: false,
      }),
    ])
    expect((answer.body as { redactions: number }[])[0]?.redactions).toBeGreaterThan(20)

    // The site and its installation stay (#848), without anything of the customer.
    expect(await tracesOf(family)).toEqual(['sites.city', 'sites.designation', 'sites.street'])
    expect(
      (await admin.query('select designation, notes from sites where id = $1', [site])).rows,
    ).toEqual([{ designation: `Quitten${family} 3`, notes: null }])
    expect(
      (await admin.query('select 1 from installations where id = $1', [installation])).rowCount,
    ).toBe(1)

    // What travels is an empty row marked as deleted.
    const marked = await admin.query<{ name: string; deleted: boolean }>(
      'select name, deleted_at is not null as deleted from customers where id = $1',
      [customer],
    )

    expect(marked.rows).toEqual([{ name: 'Gelöschter Kunde', deleted: true }])
    expect(
      (
        await admin.query(
          'select count(*)::int as n from documents where id = any($1) and deleted_at is not null',
          [[invoice, report]],
        )
      ).rows,
    ).toEqual([{ n: 2 }])
    expect((await admin.query('select designation from jobs where id = $1', [job])).rows).toEqual([
      { designation: 'Gelöschter Auftrag' },
    ])

    // What stays on the server goes, the files of its documents and its own.
    for (const table of [
      'communications',
      'document_snapshots',
      'document_files',
      'payments',
      'attachment_versions',
      'files',
      'secrets',
      'prospects',
    ]) {
      expect([table, (await admin.query(`select 1 from ${table}`)).rowCount]).toEqual([table, 0])
    }

    // The outbox is the foundation's: the mail stays, empty, and goes nowhere.
    expect(
      (await admin.query('select recipient_address, subject, status from mail_outbox')).rows,
    ).toEqual([{ recipient_address: '', subject: '', status: 'failed' }])

    // The request is done, and the chain of the log checks out.
    expect(
      (await admin.query('select status from erasure_requests where customer_id = $1', [customer]))
        .rows,
    ).toEqual([{ status: 'erased' }])

    const chain = await admin.query<{ problem: string | null }>(
      'select problem from verify_audit_chain($1)',
      [north],
    )

    expect(chain.rows.filter((row) => row.problem !== null)).toEqual([])
  })

  it('is for whoever leads the business, at the route and in the database', async () => {
    const { customer } = await vossberg()

    await record(customer).expect(201)
    await erase(customer, office).expect(403)

    expect(
      await refusedWith(
        asApplication(
          `insert into erasures (tenant_id, kind, record_id, label, automatic, redactions, created_by)
           values ('${north}', 'customer', '${customer}', 'Privatkunde', false, 0, 'bruno')`,
          'bruno',
        ),
      ),
    ).toContain('row-level security')
  })

  it('refuses a customer that something holds or that is not due, and deletes none of those asked for', async () => {
    const { family, customer, job } = await vossberg()

    expect(refusal(await erase(customer).expect(409))).toBe(
      'Ein ausgewählter Kunde ist noch nicht zum Löschen fällig.',
    )

    await record(customer).expect(201)
    await admin.query("update jobs set status = 'active' where id = $1", [job])

    expect(refusal(await erase(customer).expect(409))).toBe(
      'Ein ausgewählter Kunde bleibt noch: Ein Auftrag ist noch offen.',
    )
    expect(
      (await admin.query('select name from customers where id = $1', [customer])).rows,
    ).toEqual([{ name: `Ingrid ${family}` }])
  })

  it('lets nobody who does not lead open the locks for a customer', async () => {
    const { customer, invoice } = await vossberg()

    // One transaction, as a deletion would run: the line of the protocol is
    // refused, and with it everything after it.
    const attempt = database.forTenant({ tenantId: north, userId: 'bruno' }, async (tx) => {
      await tx.execute(
        sql.raw(`insert into erasures (tenant_id, kind, record_id, label, automatic, redactions, created_by)
                 values ('${north}', 'customer', '${customer}', 'Privatkunde', false, 0, 'bruno')`),
      )
      await tx.execute(sql.raw(`delete from communications where customer_id = '${customer}'`))
      await tx.execute(sql.raw(`update documents set subject = 'x' where id = '${invoice}'`))
    })

    expect(await refusedWith(attempt)).toContain('row-level security')
    expect(
      await refusedWith(
        asApplication(`delete from communications where customer_id = '${customer}'`, 'bruno'),
      ),
    ).toContain('Eintrag im Verlauf')
    expect(
      (
        await admin.query('select count(*)::int as n from communications where customer_id = $1', [
          customer,
        ])
      ).rows,
    ).toEqual([{ n: 1 }])
    expect(
      (await admin.query('select subject from documents where id = $1', [invoice])).rows,
    ).toEqual([{ subject: expect.stringMatching(/^Rechnung /) as unknown }])
  })

  it('opens the locks for nothing else: outside a deletion they hold as before', async () => {
    const { customer, invoice } = await vossberg()

    for (const [statement, sentence] of [
      [`delete from communications where customer_id = '${customer}'`, 'Eintrag im Verlauf'],
      [`update job_notes set text = 'x'`, 'Notiz am Auftrag'],
      [`update early_start_requests set signer_name = 'x'`, 'früheren Beginn'],
      [`update document_signatures set signer_name = 'x'`, 'Unterschrift'],
      [`delete from document_files where document_id = '${invoice}'`, 'festgeschriebenen Beleg'],
      [
        `delete from document_snapshots where document_id = '${invoice}'`,
        'festgeschriebenen Beleg',
      ],
      [
        `update document_lines set designation = 'x' where document_id = '${invoice}'`,
        'Positionen',
      ],
      [`update documents set subject = 'x' where id = '${invoice}'`, 'festgeschriebener Beleg'],
    ] as const) {
      expect([statement, await refusedWith(asApplication(statement))]).toEqual([
        statement,
        expect.stringContaining(sentence),
      ])
    }
  })

  it('keeps its protocol: the count is set in its own transaction and never after', async () => {
    const { customer } = await vossberg()

    await record(customer).expect(201)
    await erase(customer).expect(201)

    expect(await refusedWith(asApplication('update erasures set redactions = 0'))).toContain(
      'wird nicht geändert',
    )
  })

  it('closes the locks again once the deletion is done', async () => {
    const { customer, invoice } = await vossberg()

    await record(customer).expect(201)
    await erase(customer).expect(201)

    expect(
      await refusedWith(
        asApplication(`update documents set subject = 'x' where id = '${invoice}'`),
      ),
    ).toContain('festgeschriebener Beleg')
  })

  it('goes by itself when the business set it to, in the name of who did', async () => {
    const { family, customer } = await vossberg()

    await http().put('/privacy/automations/customer').set('x-test-identity', owner).expect(200)
    // What a deadline does waits for the morning of its day: the pass runs at noon.
    await runDeadlinesOf({ database }, north, new Date(`${today}T10:00:00Z`))

    const { rows } = await admin.query<{ automatic: boolean; created_by: string }>(
      "select automatic, created_by from erasures where kind = 'customer' and record_id = $1",
      [customer],
    )

    expect(rows).toEqual([{ automatic: true, created_by: 'lena' }])
    expect(await tracesOf(family)).toEqual(['sites.city', 'sites.designation', 'sites.street'])
  })

  it('reaches every device as an empty row marked as deleted', async () => {
    const { customer } = await vossberg()
    const cursor = (
      (await http().get('/sync?since=0').set('x-test-identity', owner).expect(200)).body as {
        cursor: number
      }
    ).cursor

    await record(customer).expect(201)
    await erase(customer).expect(201)

    const pulled = await http()
      .get(`/sync?since=${String(cursor)}`)
      .set('x-test-identity', owner)
      .expect(200)
    const row = (
      pulled.body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
    ).changes
      .find((change) => change.entity === 'customers')
      ?.rows.find((entry) => entry['id'] === customer)

    expect(row).toMatchObject({ name: 'Gelöschter Kunde', email: null })
    expect(row?.['deletedAt']).not.toBeNull()
  })

  it('does not reach into another business', async () => {
    const { family, customer } = await vossberg()

    await record(customer).expect(201)
    await erase(customer, person('sven', ['owner'], south)).expect(409)
    expect(
      (await admin.query('select name from customers where id = $1', [customer])).rows,
    ).toEqual([{ name: `Ingrid ${family}` }])
  })
})
