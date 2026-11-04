import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { erasures } from '../database/schema/index.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { ApiModule } from './api.module.js'
import { testIdentities as identities } from './test-identity.js'

/**
 * The deletion concept, its groundwork (#317): a lead that never became a
 * customer is proposed twelve months after its last contact; whoever leads
 * the business confirms, or switches the kind to go by itself. Deleting takes
 * the row, blacks out every value of it in the change log (ADR 0013) and
 * writes a line of the protocol that names nobody.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

/** The header of somebody with a user of her own, which `as` does not give. */
function person(userId: string, roles: string[], tenantId: TenantId = north) {
  return JSON.stringify({ userId, tenantId, roles })
}

const owner = person('lena', ['owner'])
const office = person('bruno', ['office'])

/** The morning of the day the story is told, Berlin time, after the reminders may start. */
const morning = new Date('2026-11-04T08:00:00Z')

function http() {
  return request(app.getHttpServer())
}

function refusal(answer: { body: unknown }): string {
  return String((answer.body as { message?: string }).message)
}

/** Whether the database refused a statement by a policy, through the wrapping of the query builder. */
async function refusedByPolicy(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause

    return String(cause?.message ?? (error as Error).message)
  }

  return 'went through'
}

async function lead(values: Record<string, unknown>): Promise<string> {
  const answer = await http()
    .post('/prospects')
    .set('x-test-identity', office)
    .send({ kind: 'private', source: 'website', ...values })
    .expect(201)

  return (answer.body as { id: string }).id
}

interface Overview {
  due: { recordId: string; name: string; detail: string; dueOn: string }[]
  erasures: { label: string; erasedBy: string; automatic: boolean; redactions: number }[]
  automations: { kind: string; enabledBy: string }[]
  leads: boolean
}

async function overview(who = owner): Promise<Overview> {
  const answer = await http().get('/privacy').set('x-test-identity', who).expect(200)

  return answer.body as Overview
}

async function prospectExists(id: string): Promise<boolean> {
  const found = await admin.query('select 1 from prospects where id = $1', [id])

  return found.rowCount === 1
}

let old = ''
/** When the leads of the running test were written, by the clock of the database. */
let since = new Date(0)
let recent = ''
let converted = ''

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
       ($2, 'owner', 'Inhaber', '{}', true, false)`,
    [north, south],
  )
  await admin.query(
    `insert into auth_users (id, name, email) values
       ('lena', 'Lena Leitung', 'lena@example.de'), ('bruno', 'Bruno Büro', 'bruno@example.de'),
       ('sven', 'Sven Süd', 'sven@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, 'lena', '{owner}'), ($1, 'bruno', '{office}'), ($2, 'sven', '{owner}')`,
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
  await admin.query(
    `begin; set local session_replication_role = replica;
     delete from erasures; delete from erasure_automations; delete from deadlines;
     delete from prospects; delete from sites; delete from customers;
     delete from deadline_settings; commit;`,
  )
  await admin.query("update memberships set blocked_at = null where user_id = 'lena'")
  since = (await admin.query<{ at: Date }>('select now() as at')).rows[0]?.at ?? new Date(0)

  old = await lead({
    name: 'Sandra Brenner',
    concern: 'Wallbox in der Garage',
    email: 'sandra.brenner@example.de',
    lastContactOn: '2025-09-30',
  })
  // A second change, so that the log holds a value before and after.
  await http()
    .patch(`/prospects/${old}`)
    .set('x-test-identity', office)
    .send({ stage: 'contacted' })
    .expect(200)
  recent = await lead({ name: 'Markus Lehmann', lastContactOn: '2026-10-21', source: 'phone' })

  const customer = newId<'customer'>()
  const site = newId<'site'>()

  await admin.query(
    "insert into customers (id, tenant_id, kind, name) values ($1, $2, 'private', 'Familie Weber')",
    [customer, north],
  )
  await admin.query(
    "insert into sites (id, tenant_id, customer_id, designation) values ($1, $2, $3, 'Birkenweg 7')",
    [site, north, customer],
  )
  converted = newId<'prospect'>()
  await admin.query(
    `insert into prospects (id, tenant_id, name, source, last_contact_on, customer_id, site_id, converted_at)
     values ($1, $2, 'Familie Weber', 'referral', '2025-08-01', $3, $4, now())`,
    [converted, north, customer, site],
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('what is due (#317)', () => {
  it('is a lead that never became a customer, twelve months after its last contact', async () => {
    await runDeadlinesOf({ database }, north, morning)

    const seen = await overview(office)

    expect(seen.due).toEqual([
      expect.objectContaining({
        recordId: old,
        name: 'Sandra Brenner',
        detail: 'Website · Wallbox in der Garage · letzter Kontakt 30.09.2025',
        dueOn: '2026-09-30',
      }),
    ])
    expect(seen.leads).toBe(false)
    expect((await overview(owner)).leads).toBe(true)
  })

  it('is proposed by a deadline that names nobody', async () => {
    await runDeadlinesOf({ database }, north, morning)

    const labels = await admin.query<{ source_label: string }>(
      "select source_label from deadlines where kind = 'privacy.prospect_erasure' order by due_on",
    )

    expect(labels.rows.map((row) => row.source_label)).toEqual([
      'Lead von der Website, letzter Kontakt 30.09.2025',
      'Lead aus einem Anruf, letzter Kontakt 21.10.2026',
    ])
  })

  it('moves with the months the business sets for the kind', async () => {
    await admin.query(
      `insert into deadline_settings (tenant_id, kind, interval_months) values ($1, 'privacy.prospect_erasure', 24)`,
      [north],
    )

    await runDeadlinesOf({ database }, north, morning)

    expect((await overview()).due).toEqual([])

    const due = await admin.query<{ due_on: string }>(
      "select due_on::text from deadlines where kind = 'privacy.prospect_erasure' and source_id = $1",
      [old],
    )

    expect(due.rows).toEqual([{ due_on: '2027-09-30' }])
  })
})

describe('deleting what is due (#317)', () => {
  it('takes the lead, blacks out every value of it in the change log and writes a line without a name', async () => {
    await runDeadlinesOf({ database }, north, morning)

    const answer = await http()
      .post('/privacy/erasures')
      .set('x-test-identity', owner)
      .send({ kind: 'prospect', ids: [old] })
      .expect(201)
    const [line] = answer.body as { label: string; erasedBy: string; redactions: number }[]

    expect(await prospectExists(old)).toBe(false)
    expect(line).toMatchObject({
      label: 'Lead von der Website, letzter Kontakt 30.09.2025',
      erasedBy: 'lena',
      automatic: false,
      dueOn: '2026-09-30',
    })

    const left = await admin.query<{ values: number; redactions: number }>(
      `select count(*) filter (where old_value is not null or new_value is not null)::int as values,
              (select count(*) from audit_redactions r join audit_entries e on e.id = r.entry_id
                where e.record_id = $1)::int as redactions
         from audit_entries where table_name = 'prospects' and record_id = $1`,
      [old],
    )

    expect(left.rows[0]).toEqual({ values: 0, redactions: line?.redactions })
    expect(line?.redactions).toBeGreaterThan(5)

    // Every entry since this lead was written, of every table: the leads of
    // the tests before stay in the log, which nothing may shorten.
    const anywhere = await admin.query<{ table_name: string; field: string }>(
      `select table_name, field from audit_entries
        where tenant_id = $1 and changed_at >= $2
          and coalesce(old_value, '') || coalesce(new_value, '') ~ 'Brenner|sandra\\.brenner|Wallbox in der Garage'
       union all select 'erasures', 'label' from erasures where label ~ 'Brenner'
       union all select 'deadlines', 'source_label' from deadlines where source_label ~ 'Brenner'`,
      [north, since],
    )

    expect(anywhere.rows).toEqual([])

    const chain = await admin.query<{ problem: string | null }>(
      'select problem from verify_audit_chain($1)',
      [north],
    )

    expect(chain.rows.filter((row) => row.problem !== null)).toEqual([])
    expect((await overview()).erasures).toEqual([expect.objectContaining({ erasedBy: 'lena' })])
  })

  it('is for whoever leads the business, at the route and in the database', async () => {
    await runDeadlinesOf({ database }, north, morning)

    const answer = await http()
      .post('/privacy/erasures')
      .set('x-test-identity', office)
      .send({ kind: 'prospect', ids: [old] })
      .expect(403)

    expect(refusal(answer)).toContain('wer den Betrieb führt')
    expect(await prospectExists(old)).toBe(true)

    expect(
      await refusedByPolicy(
        database.forTenant({ tenantId: north, userId: 'bruno' }, (tx) =>
          tx.insert(erasures).values({
            tenantId: north,
            kind: 'prospect',
            recordId: old,
            label: 'Lead von der Website',
            automatic: false,
            redactions: 0,
            createdBy: 'bruno',
          }),
        ),
      ),
    ).toContain('row-level security')
    expect(await prospectExists(old)).toBe(true)
  })

  it('refuses a lead that is not due or became a customer, and then deletes none of those asked for', async () => {
    await runDeadlinesOf({ database }, north, morning)

    for (const ids of [[old, recent], [converted]]) {
      const answer = await http()
        .post('/privacy/erasures')
        .set('x-test-identity', owner)
        .send({ kind: 'prospect', ids })
        .expect(409)

      expect(refusal(answer)).toMatch(/noch nicht zum Löschen fällig|Kunde geworden/)
    }

    expect(await prospectExists(old)).toBe(true)
    expect(await prospectExists(converted)).toBe(true)
    expect((await overview()).erasures).toEqual([])
  })

  it('refuses a lead that became a customer after it fell due, until the next pass lets it drop', async () => {
    await runDeadlinesOf({ database }, north, morning)
    await http()
      .post(`/prospects/${old}/conversion`)
      .set('x-test-identity', office)
      .send({})
      .expect(201)

    const answer = await http()
      .post('/privacy/erasures')
      .set('x-test-identity', owner)
      .send({ kind: 'prospect', ids: [old] })
      .expect(409)

    expect(refusal(answer)).toContain('Kunde geworden')
    expect(await prospectExists(old)).toBe(true)
  })

  it('keeps its protocol as written: the application may neither change nor delete a line', async () => {
    await runDeadlinesOf({ database }, north, morning)
    await http()
      .post('/privacy/erasures')
      .set('x-test-identity', owner)
      .send({ kind: 'prospect', ids: [old] })
      .expect(201)

    for (const statement of [
      sql`update erasures set label = 'Sandra Brenner'`,
      sql`delete from erasures`,
    ]) {
      expect(
        await refusedByPolicy(
          database.forTenant({ tenantId: north, userId: 'lena' }, (tx) => tx.execute(statement)),
        ),
      ).toContain('permission denied')
    }

    expect((await overview()).erasures).toHaveLength(1)
  })

  it('names what is due only to whoever may see leads, and lets nobody else confirm', async () => {
    await runDeadlinesOf({ database }, north, morning)

    // Leads the business, reads the settings and not the leads: a role of a business's own.
    const settingsOnly = JSON.stringify({
      userId: 'lena',
      tenantId: north,
      roles: ['owner'],
      rights: ['settings.read'],
    })

    expect((await overview(settingsOnly)).due).toBeNull()

    const answer = await http()
      .post('/privacy/erasures')
      .set('x-test-identity', settingsOnly)
      .send({ kind: 'prospect', ids: [old] })
      .expect(403)

    expect(refusal(answer)).toContain('Leads')
    expect(await prospectExists(old)).toBe(true)
  })

  it('does not reach into another business', async () => {
    await runDeadlinesOf({ database }, north, morning)

    const answer = await http()
      .post('/privacy/erasures')
      .set('x-test-identity', person('sven', ['owner'], south))
      .send({ kind: 'prospect', ids: [old] })
      .expect(409)

    expect(refusal(answer)).toContain('nicht mehr da')
    expect(await prospectExists(old)).toBe(true)
  })
})

describe('deleting by itself (#317)', () => {
  it('deletes in the name of who switched it on, what is due already included', async () => {
    await runDeadlinesOf({ database }, north, morning)
    expect(await prospectExists(old)).toBe(true)

    await http().put('/privacy/automations/prospect').set('x-test-identity', owner).expect(200)
    await runDeadlinesOf({ database }, north, new Date('2026-11-04T08:05:00Z'))

    expect(await prospectExists(old)).toBe(false)
    expect(await prospectExists(recent)).toBe(true)

    const seen = await overview()

    expect(seen.automations).toEqual([
      expect.objectContaining({ kind: 'prospect', enabledBy: 'lena' }),
    ])
    expect(seen.erasures).toEqual([
      expect.objectContaining({
        erasedBy: 'lena',
        automatic: true,
        label: expect.stringContaining('30.09.2025'),
      }),
    ])

    const values = await admin.query(
      `select 1 from audit_entries where table_name = 'prospects' and record_id = $1
          and (old_value is not null or new_value is not null)`,
      [old],
    )

    expect(values.rowCount).toBe(0)
  })

  it('stops once that person no longer leads the business, and waits for a confirmation', async () => {
    await http().put('/privacy/automations/prospect').set('x-test-identity', owner).expect(200)
    await admin.query("update memberships set blocked_at = now() where user_id = 'lena'")

    await runDeadlinesOf({ database }, north, morning)

    expect(await prospectExists(old)).toBe(true)
    expect((await overview(office)).due.map((entry) => entry.recordId)).toEqual([old])
  })

  it('is switched on and off by whoever leads the business and nobody else', async () => {
    const answer = await http()
      .put('/privacy/automations/prospect')
      .set('x-test-identity', office)
      .expect(403)

    expect(refusal(answer)).toContain('wer den Betrieb führt')
    await http().put('/privacy/automations/prospect').set('x-test-identity', owner).expect(200)
    await http().delete('/privacy/automations/prospect').set('x-test-identity', office).expect(403)
    expect((await overview()).automations).toHaveLength(1)

    await http().delete('/privacy/automations/prospect').set('x-test-identity', owner).expect(200)
    expect((await overview()).automations).toEqual([])
    await http().put('/privacy/automations/staff').set('x-test-identity', owner).expect(404)

    expect(
      await refusedByPolicy(
        database.forTenant({ tenantId: north, userId: 'bruno' }, (tx) =>
          tx.execute(
            sql`insert into erasure_automations (tenant_id, kind, created_by) values (${north}, 'prospect', 'bruno')`,
          ),
        ),
      ),
    ).toContain('row-level security')
  })
})
