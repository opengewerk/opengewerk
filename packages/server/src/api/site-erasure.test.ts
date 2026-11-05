import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { addMonths, berlinClock, type TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The site of a deleted customer under the deletion concept (#848): kept
 * with its installations and protocols as proof until ten years after the
 * youngest signed protocol there, else after its last job closed, and then
 * deleted with everything that hangs on it, unless a maintenance contract
 * there has not ended.
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

const uuid = () => newId<'customer'>() as string
/** A hash of its own for every file, so that two fixtures never share one. */
const hash = () => randomBytes(32).toString('hex')

/** A code of a label, as the labels print it: sixteen of the characters that read without doubt. */
function labelCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

  return Array.from(
    { length: 16 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('')
}

interface Fixture {
  /** The family name of this one, unlike every other test's. */
  readonly family: string
  readonly customer: string
  readonly site: string
  readonly cabinet: string
  readonly pv: string
  readonly appliance: string
  readonly defect: string
  readonly applianceTest: string
  readonly acceptance: string
  readonly siteFile: string
}

/**
 * A customer with a site that has something in every table the deletion of
 * a site reaches, the family name in each: Erika Hollberg, Hollweg 7. Its
 * youngest signed protocol is the test of an appliance on 20.04.2015, the
 * protocol of the meter cabinet is of 2014 and the acceptance of its job of
 * 2013, so the site is due once the customer is gone.
 */
async function hollberg(): Promise<Fixture> {
  const family = `Hollberg${newId<'customer'>().slice(-6)}`
  const customer = uuid()
  const site = uuid()
  const cabinet = uuid()
  const pv = uuid()
  const battery = uuid()
  const board = uuid()
  const circuit = uuid()
  const inverter = uuid()
  const string = uuid()
  const appliance = uuid()
  const job = uuid()
  const defect = uuid()
  const applianceTest = uuid()
  const acceptance = uuid()
  const siteFile = uuid()
  const cabinetFile = uuid()
  const defectFile = uuid()
  const access = uuid()
  const tag = uuid()
  const [photo, plan, close] = [hash(), hash(), hash()]

  await admin.query(
    `begin;
     set local app.user_id = 'bruno';
     insert into customers (id, tenant_id, kind, name, email, created_at)
       values ('${customer}', '${north}', 'private', 'Erika ${family}', 'erika@${family.toLowerCase()}.example', '2012-01-10');
     insert into sites (id, tenant_id, customer_id, designation, street, house_number, postal_code, city, notes)
       values ('${site}', '${north}', '${customer}', 'Hollweg${family} 7', 'Hollweg${family}', '7', '22222',
               'Holl${family}', 'Katze der ${family}s im Flur');
     insert into installations (id, tenant_id, site_id, kind, designation, notes)
       values ('${cabinet}', '${north}', '${site}', 'meter_cabinet', 'Zählerschrank ${family}', 'Bei ${family} im Keller');
     insert into installations (id, tenant_id, site_id, kind, designation, manufacturer, serial_number, commissioned_on)
       values ('${pv}', '${north}', '${site}', 'pv_system', 'PV ${family}', 'Sonne', 'PV-${family}', '2014-03-01');
     insert into installations (id, tenant_id, site_id, kind, designation, pv_system_id)
       values ('${battery}', '${north}', '${site}', 'battery', 'Speicher ${family}', '${pv}');
     insert into distribution_boards (id, tenant_id, installation_id, kind, designation, location)
       values ('${board}', '${north}', '${cabinet}', 'main_distribution', 'Verteiler ${family}', 'Keller ${family}');
     insert into board_sections (tenant_id, distribution_board_id, designation)
       values ('${north}', '${board}', 'Reihe ${family}');
     insert into circuits (id, tenant_id, distribution_board_id, designation, consumer, rated_current_milli, cable_cross_section_milli)
       values ('${circuit}', '${north}', '${board}', 'F1', 'Sauna ${family}', 16000, 2500);
     insert into equipment (tenant_id, circuit_id, designation, serial_number)
       values ('${north}', '${circuit}', 'Steckdose ${family}', 'EQ-${family}');
     insert into inverters (id, tenant_id, installation_id, designation, serial_number, rated_power_w)
       values ('${inverter}', '${north}', '${pv}', 'WR ${family}', 'WR-${family}', 8000);
     insert into pv_strings (id, tenant_id, inverter_id, designation, tilt_deg)
       values ('${string}', '${north}', '${inverter}', 'String ${family}', 30);
     insert into pv_modules (tenant_id, pv_string_id, model, serial_number)
       values ('${north}', '${string}', 'Modul ${family}', 'MOD-${family}');
     insert into installation_labels (tenant_id, installation_id, code)
       values ('${north}', '${cabinet}', '${labelCode()}');
     insert into installation_labels (tenant_id, installation_id, code, blocked_at)
       values ('${north}', '${cabinet}', '${labelCode()}', '2016-01-01');
     insert into appliances (id, tenant_id, site_id, designation, protection_class, location, notes)
       values ('${appliance}', '${north}', '${site}', 'Bohrmaschine ${family}', 'II', 'Werkraum ${family}', 'Von ${family} geliehen');
     insert into jobs (id, tenant_id, customer_id, site_id, installation_id, kind, status, designation, created_at)
       values ('${job}', '${north}', '${customer}', '${site}', '${cabinet}', 'project', 'completed', 'Umbau ${family}', '2013-01-10');
     insert into form_records (tenant_id, definition_key, definition_version, installation_id, performed_on, status, "values")
       values ('${north}', 'vde_0100_600', 1, '${cabinet}', '2014-03-10', 'signed', '{"tester": "Prüfer ${family}"}');
     insert into form_records (id, tenant_id, definition_key, definition_version, appliance_id, performed_on, status, "values")
       values ('${applianceTest}', '${north}', 'dguv_v3', 1, '${appliance}', '2015-04-20', 'signed', '{"note": "Gerät ${family}"}');
     insert into form_records (id, tenant_id, definition_key, definition_version, job_id, performed_on, status, "values")
       values ('${acceptance}', '${north}', 'acceptance', 1, '${job}', '2013-06-01', 'signed', '{"reservations": "Riss bei ${family}"}');
     insert into defects (id, tenant_id, installation_id, description, reported_at)
       values ('${defect}', '${north}', '${cabinet}', 'Wackelkontakt bei ${family}', '2015-01-05');
     insert into defect_steps (tenant_id, defect_id, step, taken_at) values ('${north}', '${defect}', 'resolved', '2015-01-06');
     insert into defect_steps (tenant_id, defect_id, step, taken_at, signer_name, signature_path)
       values ('${north}', '${defect}', 'accepted', '2015-01-07', 'Erika ${family}', 'M1,1L2,2');
     insert into files (tenant_id, sha256, size_bytes, media_type)
       values ('${north}', '${photo}', 10, 'image/jpeg'), ('${north}', '${plan}', 10, 'application/pdf'),
              ('${north}', '${close}', 10, 'image/jpeg');
     insert into attachments (id, tenant_id, site_id, title) values ('${siteFile}', '${north}', '${site}', 'Haus ${family}');
     insert into attachments (id, tenant_id, installation_id, title)
       values ('${cabinetFile}', '${north}', '${cabinet}', 'Plan ${family}');
     insert into attachments (id, tenant_id, installation_id, defect_id, title)
       values ('${defectFile}', '${north}', '${cabinet}', '${defect}', 'Kontakt ${family}');
     insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
       values ('${north}', '${siteFile}', '${photo}', '${family.toLowerCase()}-haus.jpg', 'image/jpeg', 10),
              ('${north}', '${cabinetFile}', '${plan}', '${family.toLowerCase()}-plan.pdf', 'application/pdf', 10),
              ('${north}', '${defectFile}', '${close}', '${family.toLowerCase()}-kontakt.jpg', 'image/jpeg', 10);
     insert into pv_handovers (tenant_id, installation_id, handed_over_on, content)
       values ('${north}', '${pv}', '2014-03-15', '{"owner": "Erika ${family}"}');
     insert into tags (id, tenant_id, name) values ('${tag}', '${north}', 'Wärmepumpe ${tag.slice(-6)}');
     insert into site_tags (tenant_id, site_id, tag_id) values ('${north}', '${site}', '${tag}');
     insert into site_accesses (id, tenant_id, site_id, designation, hint)
       values ('${access}', '${north}', '${site}', 'Schlüssel ${family}', 'beim Nachbarn');
     insert into secrets (tenant_id, purpose, sealed, record_id) values ('${north}', 'site_access', 'versiegelt', '${access}');
     insert into site_access_reveals (tenant_id, site_access_id, user_id, revealed_at, device_id)
       values ('${north}', '${access}', 'tom', '2016-02-01', 'tablet-tom');
     insert into site_access_deliveries (tenant_id, site_access_id, user_id, value_set_at, device_id)
       values ('${north}', '${access}', 'tom', '2016-02-01', 'tablet-tom');
     insert into deadlines (tenant_id, kind, source_id, source_label, installation_id, site_id, anchor_on, due_on)
       values ('${north}', 'installation.inspection', '${cabinet}', 'Prüfung ${family}', '${cabinet}', '${site}',
               '2014-03-10', '2018-03-10');
     commit;`,
  )
  // Closed in 2013; the trigger that stamps the day a job closes knows only today.
  await admin.query(
    `begin; set local session_replication_role = replica;
     update jobs set closed_at = '2013-06-01' where id = '${job}'; commit;`,
  )

  return {
    family,
    customer,
    site,
    cabinet,
    pv,
    appliance,
    defect,
    applianceTest,
    acceptance,
    siteFile,
  }
}

/** A customer with a bare site, and a job there closed on a day when one is named. */
async function bare(closedOn: string | null): Promise<{ customer: string; site: string }> {
  const family = `Kahl${newId<'customer'>().slice(-6)}`
  const customer = uuid()
  const site = uuid()
  const job = uuid()

  await admin.query(
    `begin;
     set local app.user_id = 'bruno';
     insert into customers (id, tenant_id, kind, name, created_at)
       values ('${customer}', '${north}', 'business', '${family} GmbH', '2012-01-10');
     insert into sites (id, tenant_id, customer_id, designation) values ('${site}', '${north}', '${customer}', 'Halle ${family}');
     ${
       closedOn === null
         ? ''
         : `insert into jobs (id, tenant_id, customer_id, site_id, kind, status, designation, created_at)
              values ('${job}', '${north}', '${customer}', '${site}', 'project', 'completed', 'Halle', '2015-01-10');`
     }
     commit;`,
  )

  if (closedOn !== null) {
    await admin.query(
      `begin; set local session_replication_role = replica;
       update jobs set closed_at = '${closedOn}' where id = '${job}'; commit;`,
    )
  }

  return { customer, site }
}

/**
 * Every place the family name still stands, by table and column: after the
 * deletion of the site, none.
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

/** Deletes a customer as the office does, on its request. */
async function deleteCustomer(customer: string) {
  await http()
    .post('/privacy/requests')
    .set('x-test-identity', office)
    .send({ customerId: customer, receivedOn: today, channel: 'email' })
    .expect(201)
  await http()
    .post('/privacy/erasures')
    .set('x-test-identity', owner)
    .send({ kind: 'customer', ids: [customer] })
    .expect(201)
}

function eraseSites(sites: string[], who = owner) {
  return http()
    .post('/privacy/erasures')
    .set('x-test-identity', who)
    .send({ kind: 'site', ids: sites })
}

async function siteDeadlines() {
  const { rows } = await admin.query<{ source_id: string; source_label: string; due_on: string }>(
    `select source_id, source_label, due_on::text from deadlines
      where kind = 'privacy.site_erasure' and status = 'open' order by due_on, source_label`,
  )

  return rows
}

/**
 * A pass of the deadlines. What a deadline does waits for the morning of its
 * day, so the one that is to delete runs at noon of today.
 */
function pass(at = new Date()) {
  return runDeadlinesOf({ database }, north, at)
}

const noon = () => new Date(`${today}T10:00:00Z`)

/** A maintenance contract at a site that has not ended, as nothing but the row. */
async function runningContract(customer: string, site: string) {
  await admin.query(
    `begin; set local session_replication_role = replica;
     insert into maintenance_contracts (tenant_id, number, designation, customer_id, site_id, quote_id, starts_on,
         first_visit_on, interval_months, term_months, renewal, notice_months, price_kind, payment_rhythm)
       values ('${north}', 'WV-${site.slice(-6)}', 'Wartung', '${customer}', '${site}', '${uuid()}', '2024-01-01',
               '2024-02-01', 12, 12, 'indefinite', 3, 'effort', 'visit');
     commit;`,
  )
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

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

beforeEach(async () => {
  // The change log and what blacked out its values stay, as they do in
  // operation: without the redactions of an earlier test its chain breaks.
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from erasures; delete from erasure_requests;
     delete from erasure_automations; delete from deadlines; delete from tasks; delete from maintenance_contracts;
     delete from site_access_reveals; delete from site_access_deliveries; delete from secrets;
     delete from site_accesses; delete from site_tags; delete from tags; delete from pv_handovers;
     delete from attachment_versions; delete from attachments; delete from files;
     delete from defect_steps; delete from defects; delete from form_records; delete from installation_labels;
     delete from pv_modules; delete from pv_strings; delete from inverters; delete from equipment;
     delete from circuits; delete from board_sections; delete from distribution_boards; delete from appliances;
     delete from jobs; delete from contacts; delete from installations; delete from sites; delete from customers;
     commit;`,
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('what is due (#848)', () => {
  it('is the site of a deleted customer, ten years after its youngest signed protocol', async () => {
    const { family, customer, site } = await hollberg()

    // Not while its customer is there, and not for a customer deleted some other way.
    await pass()
    expect(await siteDeadlines()).toEqual([])

    await deleteCustomer(customer)
    await pass()

    // Due ten years after 20.04.2015, and never before its customer went, today.
    expect(await siteDeadlines()).toEqual([
      { source_id: site, source_label: 'Objekt, letztes Protokoll 20.04.2015', due_on: today },
    ])

    const overview = await http().get('/privacy').set('x-test-identity', owner).expect(200)

    expect((overview.body as { due: unknown[] }).due).toContainEqual(
      expect.objectContaining({
        kind: 'site',
        recordId: site,
        name: `Hollweg${family} 7`,
        detail: `Hollweg${family} 7, 22222 Holl${family} · Objekt, letztes Protokoll 20.04.2015`,
      }),
    )
  })

  it('is no site of a customer deleted otherwise than by the deletion concept', async () => {
    const { customer } = await hollberg()

    await admin.query(
      `begin; set local session_replication_role = replica;
       update customers set deleted_at = now() where id = '${customer}'; commit;`,
    )
    await pass()

    expect(await siteDeadlines()).toEqual([])
  })

  it('counts every signed protocol at the site, an appliance of the register too, and no draft', async () => {
    const { customer, appliance, applianceTest } = await hollberg()
    const accepted = await hollberg()

    await deleteCustomer(customer)
    await deleteCustomer(accepted.customer)

    // A draft of today counts for nothing.
    await admin.query(
      `insert into form_records (tenant_id, definition_key, definition_version, appliance_id, performed_on, status)
       values ($1, 'dguv_v3', 1, $2, $3, 'draft')`,
      [north, appliance, today],
    )
    await pass()
    expect((await siteDeadlines()).map((row) => row.source_label)).toEqual([
      'Objekt, letztes Protokoll 20.04.2015',
      'Objekt, letztes Protokoll 20.04.2015',
    ])

    // A test of an appliance there and an acceptance of a job there, each
    // signed a year ago, keep their sites nine more years.
    await admin.query(
      `begin; set local session_replication_role = replica;
       update form_records set performed_on = '${addMonths(today, -12)}'
        where id in ('${applianceTest}', '${accepted.acceptance}'); commit;`,
    )
    await pass()
    expect(await siteDeadlines()).toEqual([])
  })

  it('counts from the last job closed without a protocol, and goes with its customer without either', async () => {
    const worked = await bare('2015-09-30')
    const empty = await bare(null)

    await deleteCustomer(worked.customer)
    await deleteCustomer(empty.customer)
    await pass()

    expect(await siteDeadlines()).toEqual([
      { source_id: empty.site, source_label: 'Objekt ohne Protokoll und Auftrag', due_on: today },
      {
        source_id: worked.site,
        source_label: 'Objekt ohne Protokoll, letzter Auftrag 30.09.2015',
        due_on: today,
      },
    ])
  })

  it('is held by a maintenance contract at the site that has not ended', async () => {
    const { customer, site } = await hollberg()

    await deleteCustomer(customer)
    await runningContract(customer, site)
    await pass()

    expect(await siteDeadlines()).toEqual([])
  })
})

describe('deleting a site (#848)', () => {
  it('empties it and everything that hangs on it, and leaves its name and address nowhere', async () => {
    const { family, customer, site, cabinet, pv } = await hollberg()

    await deleteCustomer(customer)
    await pass()

    const answer = await eraseSites([site]).expect(201)

    expect(answer.body).toEqual([
      expect.objectContaining({
        kind: 'site',
        label: 'Objekt, letztes Protokoll 20.04.2015',
        dueOn: today,
        erasedBy: 'lena',
        automatic: false,
      }),
    ])
    expect((answer.body as { redactions: number }[])[0]?.redactions).toBeGreaterThan(30)
    expect(await tracesOf(family)).toEqual([])

    // What travels is a row emptied and marked as deleted, from the site down.
    for (const table of [
      'sites',
      'installations',
      'distribution_boards',
      'board_sections',
      'circuits',
      'equipment',
      'inverters',
      'pv_strings',
      'pv_modules',
      'installation_labels',
      'appliances',
      'form_records',
      'defects',
      'defect_steps',
      'attachments',
      'site_tags',
      'site_accesses',
    ]) {
      const { rows } = await admin.query<{ open: number; all: number }>(
        `select count(*) filter (where deleted_at is null)::int as open, count(*)::int as all from ${table}`,
      )

      expect([table, rows[0]?.open, (rows[0]?.all ?? 0) > 0]).toEqual([table, 0, true])
    }

    expect(
      (
        await admin.query(`select designation, street, city, notes from sites where id = $1`, [
          site,
        ])
      ).rows,
    ).toEqual([{ designation: 'Gelöschtes Objekt', street: null, city: null, notes: null }])
    expect(
      (
        await admin.query(
          `select designation, manufacturer, serial_number, commissioned_on, pv_system_id
             from installations where id = any($1) order by id`,
          [[cabinet, pv]],
        )
      ).rows,
    ).toEqual(
      [cabinet, pv].sort().map(() => ({
        designation: 'Gelöscht',
        manufacturer: null,
        serial_number: null,
        commissioned_on: null,
        pv_system_id: null,
      })),
    )
    // The values of the trade go as well (decided on 04.11.2026).
    expect(
      (
        await admin.query(
          'select consumer, rated_current_milli, cable_cross_section_milli from circuits',
        )
      ).rows,
    ).toEqual([{ consumer: null, rated_current_milli: null, cable_cross_section_milli: null }])
    expect((await admin.query(`select "values" from form_records`)).rows).toEqual([
      { values: '{}' },
      { values: '{}' },
      { values: '{}' },
    ])
    // A blocked label stays blocked.
    expect(
      (
        await admin.query(
          'select count(*)::int as n from installation_labels where blocked_at is not null',
        )
      ).rows,
    ).toEqual([{ n: 1 }])

    // What stays on the server goes, the files with it.
    for (const table of [
      'pv_handovers',
      'site_access_reveals',
      'site_access_deliveries',
      'attachment_versions',
      'files',
      'secrets',
    ]) {
      expect([table, (await admin.query(`select 1 from ${table}`)).rowCount]).toEqual([table, 0])
    }

    expect(
      (
        await admin.query(
          `select source_label from deadlines where kind = 'installation.inspection'`,
        )
      ).rows,
    ).toEqual([{ source_label: 'Gelöscht' }])

    const chain = await admin.query<{ problem: string | null }>(
      'select problem from verify_audit_chain($1)',
      [north],
    )

    expect(chain.rows.filter((row) => row.problem !== null)).toEqual([])
  })

  it('is for whoever leads the business, at the route and in the database', async () => {
    const { customer, site } = await hollberg()

    await deleteCustomer(customer)
    await pass()
    await eraseSites([site], office).expect(403)

    expect(
      await refusedWith(
        asApplication(
          `insert into erasures (tenant_id, kind, record_id, label, automatic, redactions, created_by)
           values ('${north}', 'site', '${site}', 'Objekt', false, 0, 'bruno')`,
          'bruno',
        ),
      ),
    ).toContain('row-level security')
  })

  it('refuses a site that is not due or that a contract holds, and deletes none of those asked for', async () => {
    const { family, customer, site } = await hollberg()
    const other = await hollberg()

    // Its customer is still there.
    expect(refusal(await eraseSites([site]).expect(409))).toBe(
      'Objekt: ein ausgewähltes Objekt ist nicht mehr da oder nicht zum Löschen fällig.',
    )

    await deleteCustomer(customer)
    await pass()
    await runningContract(customer, site)

    expect(refusal(await eraseSites([site]).expect(409))).toBe(
      'Ein ausgewähltes Objekt bleibt noch: Ein Wartungsvertrag am Objekt ist nicht beendet.',
    )

    // One due beside one not: neither goes.
    await admin.query('delete from maintenance_contracts')
    await eraseSites([site, other.site]).expect(409)
    expect((await admin.query('select designation from sites where id = $1', [site])).rows).toEqual(
      [{ designation: `Hollweg${family} 7` }],
    )
  })

  it('opens the locks for nothing else: outside a deletion they hold as before', async () => {
    const { site, siteFile } = await hollberg()

    for (const [statement, sentence] of [
      [
        `update form_records set "values" = '{}' where status = 'signed'`,
        'unterschriebenes Protokoll',
      ],
      [`update defects set description = 'x' where status = 'accepted'`, 'abgenommen'],
      [`update defect_steps set deleted_at = now()`, 'Schritt an einem Mangel'],
      [`delete from pv_handovers`, 'Übergabe der PV-Anlagendokumentation'],
      [`delete from site_access_reveals`, 'Zugang angezeigt'],
      [`delete from site_access_deliveries`, 'welches Gerät'],
      [`select purge_attachment('${siteFile}'::uuid, 'x')`, 'endgültig gelöscht'],
    ] as const) {
      expect([statement, await refusedWith(asApplication(statement))]).toEqual([
        statement,
        expect.stringContaining(sentence),
      ])
    }

    expect(
      (await admin.query('select designation from sites where id = $1', [site])).rowCount,
    ).toBe(1)
  })

  it('opens them for the site of its line alone, and for nobody who does not lead', async () => {
    const { customer, site, applianceTest } = await hollberg()
    const other = await hollberg()

    await deleteCustomer(customer)

    // The line of another site opens nothing at this one.
    const elsewhere = database.forTenant({ tenantId: north, userId: 'lena' }, async (tx) => {
      await tx.execute(
        sql.raw(`insert into erasures (tenant_id, kind, record_id, label, automatic, redactions, created_by)
                 values ('${north}', 'site', '${other.site}', 'Objekt', false, 0, 'lena')`),
      )
      await tx.execute(
        sql.raw(`update form_records set "values" = '{}' where id = '${applianceTest}'`),
      )
    })

    expect(await refusedWith(elsewhere)).toContain('unterschriebenes Protokoll')

    // Whoever does not lead writes no line, and so opens nothing.
    const notLeading = database.forTenant({ tenantId: north, userId: 'bruno' }, async (tx) => {
      await tx.execute(
        sql.raw(`insert into erasures (tenant_id, kind, record_id, label, automatic, redactions, created_by)
                 values ('${north}', 'site', '${site}', 'Objekt', false, 0, 'bruno')`),
      )
      await tx.execute(sql.raw(`delete from pv_handovers`))
    })

    expect(await refusedWith(notLeading)).toContain('row-level security')
    expect((await admin.query('select 1 from pv_handovers')).rowCount).toBe(2)
  })

  it('closes the locks again once the deletion is done', async () => {
    const { customer, site } = await hollberg()

    await deleteCustomer(customer)
    await pass()
    await eraseSites([site]).expect(201)

    expect(
      await refusedWith(
        asApplication(`update form_records set "values" = 'x' where status = 'signed'`),
      ),
    ).toContain('unterschriebenes Protokoll')
  })

  it('goes by itself when the business set it to, in the name of who did', async () => {
    const { family, customer, site } = await hollberg()

    await deleteCustomer(customer)
    await http().put('/privacy/automations/site').set('x-test-identity', owner).expect(200)
    await pass(noon())

    const { rows } = await admin.query<{ automatic: boolean; created_by: string }>(
      "select automatic, created_by from erasures where kind = 'site' and record_id = $1",
      [site],
    )

    expect(rows).toEqual([{ automatic: true, created_by: 'lena' }])
    expect(await tracesOf(family)).toEqual([])
  })

  it('reaches every device as an empty row marked as deleted', async () => {
    const { customer, site, cabinet } = await hollberg()

    await deleteCustomer(customer)
    await pass()

    const cursor = (
      (await http().get('/sync?since=0').set('x-test-identity', owner).expect(200)).body as {
        cursor: number
      }
    ).cursor

    await eraseSites([site]).expect(201)

    const pulled = await http()
      .get(`/sync?since=${String(cursor)}`)
      .set('x-test-identity', owner)
      .expect(200)
    const changes = (
      pulled.body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
    ).changes
    const rowOf = (entity: string, id: string) =>
      changes.find((change) => change.entity === entity)?.rows.find((entry) => entry['id'] === id)

    expect(rowOf('sites', site)).toMatchObject({ designation: 'Gelöschtes Objekt', street: null })
    expect(rowOf('sites', site)?.['deletedAt']).not.toBeNull()
    expect(rowOf('installations', cabinet)).toMatchObject({ designation: 'Gelöscht', notes: null })
    expect(rowOf('installations', cabinet)?.['deletedAt']).not.toBeNull()
  })

  it('does not reach into another business', async () => {
    const { family, customer, site } = await hollberg()

    await deleteCustomer(customer)
    await pass()
    await eraseSites([site], person('sven', ['owner'], south)).expect(409)
    expect((await admin.query('select designation from sites where id = $1', [site])).rows).toEqual(
      [{ designation: `Hollweg${family} 7` }],
    )
  })
})
