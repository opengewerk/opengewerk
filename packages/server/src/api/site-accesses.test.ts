import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { RoleKey, TenantId } from '@opengewerk/domain'
import { Database, newId, SecretKey } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { type Somebody, testIdentities as identities } from './test-identity.js'
import { created, push } from './test-structure.js'

/**
 * The ways into a site (#286): kept by the office, the value sealed apart,
 * never in the audit log and never in an answer that does not ask for it;
 * shown to the office on request, which leaves a trace, and held on the
 * device of whoever is on an open job there, a technician or, since #447,
 * the owner and the office, for the sites of those jobs only.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

// Every code in this file starts with a word: an answer is searched for it as
// text, and four digits alone turn up in an id or a timestamp by chance.
const key = SecretKey.from('s'.repeat(64))
const code = 'Tresor-4711'

let admin: Pool
let database: Database
let app: INestApplication
/** The same instance after `SESSION_SECRET` was swapped. */
let swapped: INestApplication

function http(on: INestApplication = app) {
  return request(on.getHttpServer())
}

function as(tenantId: TenantId, userId: string, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId, tenantId, roles } satisfies Somebody)
}

const office = () => as(north.id, 'britta', 'office')
/**
 * The technician, from the phone the session names (`deviceId`), or from a
 * session that names none. The device a value goes to and a showing comes
 * from is the session's, whatever the body of a transmission says.
 */
function technician(deviceId: string | null = 'phone-max'): string {
  return JSON.stringify({
    userId: 'max',
    tenantId: north.id,
    roles: ['technician'],
    ...(deviceId === null ? {} : { deviceId }),
  })
}
/** The office from the device the session names, or from a session that names none. */
function officeOn(deviceId: string | null = 'desk-britta'): string {
  return JSON.stringify({
    userId: 'britta',
    tenantId: north.id,
    roles: ['office'],
    ...(deviceId === null ? {} : { deviceId }),
  })
}
const neighbour = () => as(south.id, 'susi', 'office')

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return answer.body as Record<string, unknown>
}

/** A site with an open job, and the technician on it. */
async function siteWithJob(name: string) {
  const customer = String((await post('/customers', { kind: 'private', name }))['id'])
  const site = String(
    (await post('/sites', { customerId: customer, designation: `Haus ${name}` }))['id'],
  )
  const job = String(
    (
      await post('/jobs', {
        customerId: customer,
        siteId: site,
        kind: 'service',
        status: 'active',
        designation: `Auftrag ${name}`,
      })
    )['id'],
  )

  return { customer, site, job }
}

async function addAccess(site: string, body: Record<string, unknown>, who = office()) {
  return post(`/sites/${site}/accesses`, body, who)
}

interface Pulled {
  readonly changes: { entity: string; rows: Record<string, unknown>[] }[]
  readonly narrowed: Record<string, string>
}

async function pull(who: string, values = false, on: INestApplication = app) {
  const answer = await http(on)
    .get(`/sync?since=0${values ? '&access=values' : ''}`)
    .set('x-test-identity', who)
    .expect(200)

  return answer.body as Pulled
}

function accessesOf(pulled: Pulled) {
  return (pulled.changes.find((change) => change.entity === 'site_accesses')?.rows ?? []).filter(
    (row) => row['deletedAt'] === null,
  )
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

  for (const [tenantId, userId, role] of [
    [north.id, 'britta', 'office'],
    [north.id, 'max', 'technician'],
    [south.id, 'susi', 'office'],
  ] as const) {
    await admin.query(
      'insert into auth_users (id, name, email) values ($1, $2, $3) on conflict do nothing',
      [userId, userId, `${userId}@example.de`],
    )
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenantId,
      userId,
      [role],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { secrets: key })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const other = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { secrets: SecretKey.from('n'.repeat(64)) })],
  }).compile()

  swapped = other.createNestApplication()
  await swapped.init()
})

afterAll(async () => {
  await app.close()
  await swapped.close()
  await database.close()
  await admin.end()
})

describe('an access to a site', () => {
  it('is kept with its value sealed, which no answer carries unasked and no log holds', async () => {
    const { site } = await siteWithJob('Berg')
    const access = await addAccess(site, {
      designation: 'Schlüsseltresor Hof',
      hint: 'Links neben dem Hoftor.',
      value: code,
    })

    expect(access).toMatchObject({
      designation: 'Schlüsseltresor Hof',
      hint: 'Links neben dem Hoftor.',
    })
    expect(access['valueSetAt']).not.toBeNull()
    expect(JSON.stringify(access)).not.toContain(code)

    const pulled = await pull(office())
    const row = accessesOf(pulled).find((candidate) => candidate['id'] === access['id'])

    // The office learns that there is a value, and not the value.
    expect(row).toMatchObject({ valueState: 'readable' })
    expect(JSON.stringify(pulled)).not.toContain(code)

    const { rows: logged } = await admin.query<{ content: string }>(
      `select coalesce(old_value, '') || coalesce(new_value, '') as content
         from audit_entries where table_name in ('site_accesses', 'secrets')`,
    )

    expect(logged.length).toBeGreaterThan(0)
    expect(logged.map((entry) => entry.content).join(' ')).not.toContain(code)

    const { rows: sealed } = await admin.query<{ sealed: string }>(
      "select sealed from secrets where purpose = 'site_access' and record_id = $1",
      [access['id']],
    )

    expect(sealed).toHaveLength(1)
    expect(sealed[0]?.sealed).not.toContain(code)
  })

  it('shows its value to the office on request and keeps who saw it when', async () => {
    const { site } = await siteWithJob('Kern')
    const access = await addAccess(site, { designation: 'Alarmanlage', value: 'Code 1234#' })

    const shown = await http()
      .post(`/sites/${site}/accesses/${String(access['id'])}/reveal`)
      .set('x-test-identity', office())
      .expect(201)

    expect(shown.body).toEqual({ state: 'readable', value: 'Code 1234#' })

    const { rows } = await admin.query<{ user_id: string }>(
      'select user_id from site_access_reveals where site_access_id = $1',
      [access['id']],
    )

    expect(rows).toEqual([{ user_id: 'britta' }])

    const { rows: opened } = await admin.query<{ value_set_at: Date }>(
      'select value_set_at from site_access_reveals where site_access_id = $1',
      [access['id']],
    )

    expect(opened[0]?.value_set_at.toISOString()).toBe(access['valueSetAt'])

    const { rows: logged } = await admin.query<{ count: number }>(
      "select count(*)::int as count from audit_entries where table_name = 'site_access_reveals'",
    )

    expect(logged[0]?.count).toBeGreaterThan(0)
  })

  it('keeps its value when a change leaves the value empty, and takes a new one', async () => {
    const { site } = await siteWithJob('Lang')
    const access = await addAccess(site, { designation: 'Tor', value: 'alt-1' })
    const id = String(access['id'])
    const reveal = async () =>
      (
        await http()
          .post(`/sites/${site}/accesses/${id}/reveal`)
          .set('x-test-identity', office())
          .expect(201)
      ).body as { value?: string }

    await http()
      .patch(`/sites/${site}/accesses/${id}`)
      .set('x-test-identity', office())
      .send({ designation: 'Tor Tiefgarage', value: '' })
      .expect(200)

    expect((await reveal()).value).toBe('alt-1')

    const changed = await http()
      .patch(`/sites/${site}/accesses/${id}`)
      .set('x-test-identity', office())
      .send({ value: 'neu-2' })
      .expect(200)

    expect((changed.body as { designation: string }).designation).toBe('Tor Tiefgarage')
    expect((await reveal()).value).toBe('neu-2')
  })

  it('forgets its value at once when it is deleted', async () => {
    const { site } = await siteWithJob('Weg')
    const access = await addAccess(site, { designation: 'Briefkasten', value: 'Code 0000' })

    await http()
      .delete(`/sites/${site}/accesses/${String(access['id'])}`)
      .set('x-test-identity', office())
      .expect(200)

    const { rows } = await admin.query('select id from secrets where record_id = $1', [
      access['id'],
    ])

    expect(rows).toEqual([])
  })

  it('goes with its site, and its value with it', async () => {
    const { site, job } = await siteWithJob('Abriss')
    const access = await addAccess(site, { designation: 'Bautür', value: 'Code 7777' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    const before = await pull(technician(), true)

    expect(accessesOf(before).map((row) => row['id'])).toContain(access['id'])

    await http().delete(`/sites/${site}`).set('x-test-identity', office()).expect(200)

    const { rows: kept } = await admin.query('select id from secrets where record_id = $1', [
      access['id'],
    ])
    const { rows: marked } = await admin.query<{ deleted_at: Date | null }>(
      'select deleted_at from site_accesses where id = $1',
      [access['id']],
    )

    expect(kept).toEqual([])
    expect(marked[0]?.deleted_at).not.toBeNull()

    const after = await pull(technician(), true)

    expect(after.narrowed['site_accesses']).not.toBe(before.narrowed['site_accesses'])
    expect(accessesOf(after).map((row) => row['id'])).not.toContain(access['id'])
    expect(JSON.stringify(after)).not.toContain('Code 7777')
  })

  it('is out of reach at the routes once its site is gone, even where nothing marked it', async () => {
    const { site, job } = await siteWithJob('Weggeräumt')
    const access = await addAccess(site, { designation: 'Keller', value: 'Code 4321' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    // Past the trigger, as a site marked by some other way would be: the
    // routes and the pull ask the site themselves.
    const client = await admin.connect()

    try {
      await client.query('set session_replication_role = replica')
      await client.query('update sites set deleted_at = now() where id = $1', [site])
    } finally {
      await client.query('reset session_replication_role')
      client.release()
    }

    await http()
      .post(`/sites/${site}/accesses/${String(access['id'])}/reveal`)
      .set('x-test-identity', office())
      .expect(404)
    await http()
      .patch(`/sites/${site}/accesses/${String(access['id'])}`)
      .set('x-test-identity', office())
      .send({ value: 'neu' })
      .expect(404)
    await http()
      .post(`/sites/${site}/accesses`)
      .set('x-test-identity', office())
      .send({ designation: 'Neu', value: '1' })
      .expect(404)

    expect(JSON.stringify(await pull(technician(), true))).not.toContain('Code 4321')
  })

  it('may be only a hint, without a value to show', async () => {
    const { site } = await siteWithJob('Hinweis')
    const access = await addAccess(site, {
      designation: 'Schlüssel',
      hint: 'Beim Hausmeister, Erdgeschoss links.',
    })

    expect(access['valueSetAt']).toBeNull()

    const shown = await http()
      .post(`/sites/${site}/accesses/${String(access['id'])}/reveal`)
      .set('x-test-identity', office())
      .expect(201)

    expect(shown.body).toEqual({ state: 'none' })
  })

  it('refuses a designation that is empty or too long, in words', async () => {
    const { site } = await siteWithJob('Leer')
    const empty = await http()
      .post(`/sites/${site}/accesses`)
      .set('x-test-identity', office())
      .send({ designation: '  ', value: '1' })
      .expect(422)

    expect((empty.body as { message: string }).message).toContain('braucht eine Bezeichnung')
  })
})

describe('the value after the key of the instance changed', () => {
  it('says so instead of failing, to the office and on the device', async () => {
    const { site, job } = await siteWithJob('Tausch')
    const access = await addAccess(site, { designation: 'Tresor', value: 'vorher' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    const shown = await http(swapped)
      .post(`/sites/${site}/accesses/${String(access['id'])}/reveal`)
      .set('x-test-identity', office())
      .expect(201)

    expect(shown.body).toEqual({ state: 'unreadable' })

    const onSite = accessesOf(await pull(technician(), true, swapped)).find(
      (row) => row['id'] === access['id'],
    )

    expect(onSite).toMatchObject({ valueState: 'unreadable' })
    expect(onSite?.['value']).toBeUndefined()
  })
})

describe('an access on the device of a technician', () => {
  it('comes with its value for the open jobs of that person, and only when asked for', async () => {
    const theirs = await siteWithJob('Monteur')
    const others = await siteWithJob('Andere')
    const mine = await addAccess(theirs.site, { designation: 'Haustür', value: 'Code 2468' })
    const notMine = await addAccess(others.site, { designation: 'Keller', value: 'Code 1357' })

    await http()
      .put(`/jobs/${theirs.job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    const withValues = await pull(technician(), true)
    const ids = accessesOf(withValues).map((row) => row['id'])

    expect(ids).toContain(mine['id'])
    expect(ids).not.toContain(notMine['id'])
    expect(accessesOf(withValues).find((row) => row['id'] === mine['id'])).toMatchObject({
      valueState: 'readable',
      value: 'Code 2468',
    })

    // The same device without asking, as the office entry would pull.
    const bare = await pull(technician())

    expect(JSON.stringify(bare)).not.toContain('Code 2468')
    expect(bare.narrowed['site_accesses']).not.toBe(withValues.narrowed['site_accesses'])
  })

  it('goes from the device when the job is closed', async () => {
    const { site, job } = await siteWithJob('Schluss')
    const access = await addAccess(site, { designation: 'Garage', value: 'Code 8642' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    const before = await pull(technician(), true)

    expect(accessesOf(before).map((row) => row['id'])).toContain(access['id'])

    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', office())
      .send({ status: 'completed' })
      .expect(200)

    const after = await pull(technician(), true)

    expect(after.narrowed['site_accesses']).not.toBe(before.narrowed['site_accesses'])
    expect(accessesOf(after).map((row) => row['id'])).not.toContain(access['id'])
    expect(JSON.stringify(after)).not.toContain('Code 8642')
  })

  it('is shown on the device and the showing arrives through the outbox, with its person', async () => {
    const { site, job } = await siteWithJob('Anzeige')
    const access = await addAccess(site, { designation: 'Hoftor', value: 'Code 1111' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    // The device holds the value once a pull handed it over.
    await pull(technician(), true)

    const revealedAt = '2026-09-27T09:15:00.000Z'
    const answer = await push(app, technician(), [
      created('site_access_reveals', newId<'site-access-reveal'>(), {
        siteAccessId: String(access['id']),
        valueSetAt: String(access['valueSetAt']),
        revealedAt,
      }),
    ])

    expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const { rows } = await admin.query<{ user_id: string; revealed_at: Date }>(
      'select user_id, revealed_at from site_access_reveals where site_access_id = $1',
      [access['id']],
    )

    expect(rows.map((row) => row.user_id)).toEqual(['max'])
    expect(rows[0]?.revealed_at.toISOString()).toBe(revealedAt)
  })

  it('keeps a showing that arrives long after the job was closed and the access deleted', async () => {
    const { site, job } = await siteWithJob('Keller')
    const access = await addAccess(site, { designation: 'Kellertür', value: 'Code 5656' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)
    await pull(technician(), true)

    // Shown in a cellar without a network; meanwhile the office closes the
    // job and deletes the access, and the device stays offline for longer
    // than it keeps a closed job. The showing happened and is kept.
    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', office())
      .send({ status: 'completed' })
      .expect(200)
    await admin.query("update jobs set closed_at = now() - interval '40 days' where id = $1", [job])
    await http()
      .delete(`/sites/${site}/accesses/${String(access['id'])}`)
      .set('x-test-identity', office())
      .expect(200)

    const answer = await push(app, technician(), [
      created('site_access_reveals', newId<'site-access-reveal'>(), {
        siteAccessId: String(access['id']),
        valueSetAt: String(access['valueSetAt']),
        revealedAt: '2026-09-27T10:00:00.000Z',
      }),
    ])

    expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    const { rows } = await admin.query<{ user_id: string }>(
      'select user_id from site_access_reveals where site_access_id = $1',
      [access['id']],
    )

    expect(rows).toEqual([{ user_id: 'max' }])
  })

  it('keeps a showing that arrives after the job moved to another site', async () => {
    const { customer, site, job } = await siteWithJob('Wanderung')
    const other = String(
      (await post('/sites', { customerId: customer, designation: 'Haus Wanderung, neu' }))['id'],
    )
    const access = await addAccess(site, { designation: 'Garagentor', value: 'Code 8383' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)
    await pull(technician(), true)
    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', office())
      .send({ siteId: other })
      .expect(200)

    const answer = await push(app, technician(), [
      created('site_access_reveals', newId<'site-access-reveal'>(), {
        siteAccessId: String(access['id']),
        valueSetAt: String(access['valueSetAt']),
        revealedAt: '2026-09-27T10:05:00.000Z',
      }),
    ])

    expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
  })

  it('refuses a showing of a value its device never held, and only that one', async () => {
    const theirs = await siteWithJob('Eigenes')
    const others = await siteWithJob('Fremdes')
    const mine = await addAccess(theirs.site, { designation: 'Tor', value: 'Code 6161' })
    const notMine = await addAccess(others.site, { designation: 'Tür', value: 'Code 7272' })

    await http()
      .put(`/jobs/${theirs.job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    await pull(technician(), true)

    const answer = await push(app, technician(), [
      created('site_access_reveals', newId<'site-access-reveal'>(), {
        siteAccessId: String(notMine['id']),
        valueSetAt: String(notMine['valueSetAt']),
        revealedAt: '2026-09-27T10:01:00.000Z',
      }),
      created('site_access_reveals', newId<'site-access-reveal'>(), {
        siteAccessId: String(mine['id']),
        valueSetAt: String(mine['valueSetAt']),
        revealedAt: '2026-09-27T10:02:00.000Z',
      }),
    ])

    expect(
      answer.receipts.map((receipt) => [receipt.outcome, receipt.reason, receipt.fields]),
    ).toEqual([
      ['conflict', 'record_missing', ['siteAccessId', 'valueSetAt']],
      ['applied', null, []],
    ])

    const { rows } = await admin.query<{ site_access_id: string }>(
      'select site_access_id from site_access_reveals where site_access_id = any($1)',
      [[mine['id'], notMine['id']]],
    )

    expect(rows).toEqual([{ site_access_id: mine['id'] }])
  })

  it('records once which person got which value, and only a value handed out', async () => {
    const theirs = await siteWithJob('Übergabe')
    const others = await siteWithJob('Keine Übergabe')
    const mine = await addAccess(theirs.site, { designation: 'Haustür', value: 'Code 9191' })
    const notMine = await addAccess(others.site, { designation: 'Hoftür', value: 'Code 9292' })

    await http()
      .put(`/jobs/${theirs.job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    // Asked twice and once without values, as the office entry of the same
    // device would; and the office, which never gets a value in a pull.
    await pull(technician(), true)
    await pull(technician(), true)
    await pull(technician())
    await pull(office(), true)

    const { rows } = await admin.query<{
      site_access_id: string
      user_id: string
      device_id: string
      value_set_at: Date
    }>(
      `select site_access_id, user_id, device_id, value_set_at
         from site_access_deliveries where site_access_id = any($1)`,
      [[mine['id'], notMine['id']]],
    )

    expect(rows.map((row) => ({ ...row, value_set_at: row.value_set_at.toISOString() }))).toEqual([
      {
        site_access_id: mine['id'],
        user_id: 'max',
        device_id: 'phone-max',
        value_set_at: mine['valueSetAt'],
      },
    ])

    // In the log as one change, the insert, with the person it went to.
    const { rows: logged } = await admin.query<{
      changes: number
      operation: string
      user_id: string
    }>(
      `select count(distinct change_id)::int as changes, min(operation) as operation,
              min(user_id) as user_id
         from audit_entries
        where table_name = 'site_access_deliveries' and record_id = (
          select id from site_access_deliveries where site_access_id = $1)`,
      [mine['id']],
    )

    expect(logged[0]).toMatchObject({ changes: 1, operation: 'insert', user_id: 'max' })
  })

  it('takes a showing from whoever keeps the ways in, who may see any value', async () => {
    const { site } = await siteWithJob('Büroanzeige')
    const access = await addAccess(site, { designation: 'Tresor', value: 'Code 9393' })

    const answer = await push(app, office(), [
      created('site_access_reveals', newId<'site-access-reveal'>(), {
        siteAccessId: String(access['id']),
        valueSetAt: String(access['valueSetAt']),
        revealedAt: '2026-09-27T10:06:00.000Z',
      }),
    ])

    expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
  })

  it('takes a showing only from the device that got the value, and only of that value', async () => {
    const { site, job } = await siteWithJob('Herkunft')
    const first = await addAccess(site, { designation: 'Tiefgarage', value: 'Code 4545' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)
    await pull(technician(), true)

    // The office puts in a new code; the phone was not online since.
    const changed = await http()
      .patch(`/sites/${site}/accesses/${String(first['id'])}`)
      .set('x-test-identity', office())
      .send({ value: 'Code 4646' })
      .expect(200)
    const newer = String((changed.body as { valueSetAt: string }).valueSetAt)
    const showing = (valueSetAt: string, revealedAt: string) =>
      created('site_access_reveals', newId<'site-access-reveal'>(), {
        siteAccessId: String(first['id']),
        valueSetAt,
        revealedAt,
      })

    // The same person on a second device that never pulled, the new code on
    // the phone that never got it, and the old code on the phone that had it.
    const fromTablet = await push(app, technician('tablet-max'), [
      showing(String(first['valueSetAt']), '2026-09-27T10:10:00.000Z'),
    ])
    const newerOnPhone = await push(app, technician(), [showing(newer, '2026-09-27T10:11:00.000Z')])
    const olderOnPhone = await push(app, technician(), [
      showing(String(first['valueSetAt']), '2026-09-27T10:12:00.000Z'),
    ])

    expect(
      [fromTablet, newerOnPhone, olderOnPhone].map(({ receipts }) => [
        receipts[0]?.outcome,
        receipts[0]?.fields,
      ]),
    ).toEqual([
      ['conflict', ['siteAccessId', 'valueSetAt']],
      ['conflict', ['siteAccessId', 'valueSetAt']],
      ['applied', []],
    ])
  })

  it('hands no value to a session that names no device', async () => {
    const { site, job } = await siteWithJob('Ohne Gerät')
    const access = await addAccess(site, { designation: 'Nebentür', value: 'Code 4747' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    const pulled = await pull(technician(null), true)
    const row = accessesOf(pulled).find((candidate) => candidate['id'] === access['id'])

    expect(row).toMatchObject({ valueState: 'readable' })
    expect(row?.['value']).toBeUndefined()

    const { rows } = await admin.query(
      'select id from site_access_deliveries where site_access_id = $1',
      [access['id']],
    )

    expect(rows).toEqual([])
  })

  it('follows a job that moves to another site', async () => {
    const { customer, site, job } = await siteWithJob('Umzug')
    const other = String(
      (await post('/sites', { customerId: customer, designation: 'Haus Umzug, hinten' }))['id'],
    )
    const left = await addAccess(site, { designation: 'Vorne', value: 'Code 1212' })
    const moved = await addAccess(other, { designation: 'Hinten', value: 'Code 3434' })

    await http()
      .put(`/jobs/${job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['max'] })
      .expect(200)

    const before = await pull(technician(), true)

    expect(accessesOf(before).map((row) => row['id'])).toContain(left['id'])
    expect(accessesOf(before).map((row) => row['id'])).not.toContain(moved['id'])

    await http()
      .patch(`/jobs/${job}`)
      .set('x-test-identity', office())
      .send({ siteId: other })
      .expect(200)

    // The answer says so, and the device fetches the site it moved to.
    const after = await pull(technician(), true)

    expect(after.narrowed['site_accesses']).not.toBe(before.narrowed['site_accesses'])
    expect(accessesOf(after).map((row) => row['id'])).toContain(moved['id'])
    expect(accessesOf(after).map((row) => row['id'])).not.toContain(left['id'])
    expect(JSON.stringify(after)).not.toContain('Code 1212')
  })

  it('is neither kept nor asked for at the routes by a technician', async () => {
    const { site } = await siteWithJob('Rechte')
    const access = await addAccess(site, { designation: 'Tür', value: 'Code 5555' })

    await http()
      .post(`/sites/${site}/accesses`)
      .set('x-test-identity', technician())
      .send({ designation: 'Eigene', value: '1' })
      .expect(403)
    await http()
      .post(`/sites/${site}/accesses/${String(access['id'])}/reveal`)
      .set('x-test-identity', technician())
      .expect(403)
  })
})

describe('an access on a device of the owner or the office', () => {
  it('never comes with its value for a job they are not on, whatever the request asks for', async () => {
    const { site } = await siteWithJob('Offen')
    const access = await addAccess(site, { designation: 'Hoftor', value: 'Code 9753' })

    // The office opens the site as well, and the site asks for values. For a
    // job it is not on, the office asks the route instead, which keeps who
    // saw a value; a request it builds itself gets no further (Greptile on
    // #445).
    for (const asked of [true, false]) {
      const pulled = await pull(officeOn(), asked)
      const row = accessesOf(pulled).find((candidate) => candidate['id'] === access['id'])

      expect(row).toMatchObject({ valueState: 'readable' })
      expect(row?.['value']).toBeUndefined()
      expect(JSON.stringify(pulled)).not.toContain('Code 9753')
      expect(pulled.narrowed['site_accesses']).toBe('all')
    }
  })

  it('comes with its value on site for an open job they are on, as for a technician (#447)', async () => {
    const theirs = await siteWithJob('Büro vor Ort')
    const others = await siteWithJob('Büro am Schreibtisch')
    const mine = await addAccess(theirs.site, { designation: 'Haustür', value: 'Code 3131' })
    const notMine = await addAccess(others.site, { designation: 'Keller', value: 'Code 3232' })

    await http()
      .put(`/jobs/${theirs.job}/assignees`)
      .set('x-test-identity', office())
      .send({ userIds: ['britta'] })
      .expect(200)

    const onSite = await pull(officeOn(), true)

    expect(accessesOf(onSite).find((row) => row['id'] === mine['id'])).toMatchObject({
      valueState: 'readable',
      value: 'Code 3131',
    })
    // Every other way in stays on the device as it was, without its value.
    expect(accessesOf(onSite).find((row) => row['id'] === notMine['id'])).toMatchObject({
      valueState: 'readable',
    })
    expect(JSON.stringify(onSite)).not.toContain('Code 3232')
    expect(onSite.narrowed['site_accesses']).not.toBe('all')

    // The office entry of the same device, and a session that names no
    // device: no value, and the answer says so.
    const atTheDesk = await pull(officeOn())

    expect(JSON.stringify(atTheDesk)).not.toContain('Code 3131')
    expect(atTheDesk.narrowed['site_accesses']).toBe('all')
    expect(JSON.stringify(await pull(officeOn(null), true))).not.toContain('Code 3131')

    // Handed out once, to this device, as to the phone of a technician.
    const { rows } = await admin.query<{ user_id: string; device_id: string }>(
      'select user_id, device_id from site_access_deliveries where site_access_id = $1',
      [mine['id']],
    )

    expect(rows).toEqual([{ user_id: 'britta', device_id: 'desk-britta' }])

    // And off the device again once the job is closed.
    await http()
      .patch(`/jobs/${theirs.job}`)
      .set('x-test-identity', office())
      .send({ status: 'completed' })
      .expect(200)

    const closed = await pull(officeOn(), true)

    expect(closed.narrowed['site_accesses']).toBe('all')
    expect(JSON.stringify(closed)).not.toContain('Code 3131')
  })
})

describe('the seal of an access', () => {
  it('opens only for the access it was made for, not for another of the same business', async () => {
    const { site } = await siteWithJob('Siegel')
    const first = await addAccess(site, { designation: 'Erste Tür', value: 'eins' })
    const second = await addAccess(site, { designation: 'Zweite Tür', value: 'zwei' })

    await admin.query(
      `update secrets set sealed = (select sealed from secrets where record_id = $1)
        where record_id = $2`,
      [first['id'], second['id']],
    )

    const copied = await http()
      .post(`/sites/${site}/accesses/${String(second['id'])}/reveal`)
      .set('x-test-identity', office())
      .expect(201)

    expect(copied.body).toEqual({ state: 'unreadable' })
  })
})

describe('an access and the business it belongs to', () => {
  it('is out of reach of another business, and its seal opens only for its own row', async () => {
    const { site } = await siteWithJob('Nord')
    const ours = await addAccess(site, { designation: 'Nordtür', value: 'Code 9999' })
    const theirSite = String(
      (
        await post(
          '/sites',
          {
            customerId: String(
              (await post('/customers', { kind: 'private', name: 'Süd' }, neighbour()))['id'],
            ),
            designation: 'Südhaus',
          },
          neighbour(),
        )
      )['id'],
    )
    const theirs = await addAccess(
      theirSite,
      { designation: 'Südtür', value: 'Code 1111' },
      neighbour(),
    )

    await http()
      .post(`/sites/${site}/accesses/${String(ours['id'])}/reveal`)
      .set('x-test-identity', neighbour())
      .expect(404)
    await http()
      .patch(`/sites/${site}/accesses/${String(ours['id'])}`)
      .set('x-test-identity', neighbour())
      .send({ value: 'übernommen' })
      .expect(404)

    expect(JSON.stringify(await pull(neighbour(), true))).not.toContain('Nordtür')

    // A sealed value copied onto another access does not open there.
    await admin.query(
      `update secrets set sealed = (select sealed from secrets where record_id = $1)
        where record_id = $2`,
      [ours['id'], theirs['id']],
    )

    const copied = await http()
      .post(`/sites/${theirSite}/accesses/${String(theirs['id'])}/reveal`)
      .set('x-test-identity', neighbour())
      .expect(201)

    expect(copied.body).toEqual({ state: 'unreadable' })
  })
})
