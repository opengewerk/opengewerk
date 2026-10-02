import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { RoleKey, TenantId } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
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
 * The tags of a business (#314): made, renamed and deleted at their route,
 * put on customers and sites as a whole list at the route of the record, and
 * kept to the business they were made in. A device gets them through the
 * sync, the tags of the customers and sites it holds and every tag there is.
 */

const north = { id: newId<'tenant'>() as TenantId, name: 'Elektro Nord GmbH' }
const south = { id: newId<'tenant'>() as TenantId, name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function as(tenantId: TenantId, userId: string, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId, tenantId, roles } satisfies Somebody)
}

const office = () => as(north.id, 'britta', 'office')
const technician = () => as(north.id, 'max', 'technician')
const neighbour = () => as(south.id, 'susi', 'office')

interface TagRow {
  readonly id: string
  readonly name: string
}

async function post(path: string, body: Record<string, unknown>, who = office()) {
  const answer = await http().post(path).set('x-test-identity', who).send(body).expect(201)

  return String((answer.body as { id: string }).id)
}

async function makeTag(name: string, who = office()): Promise<TagRow> {
  const answer = await http()
    .post('/customers/tags')
    .set('x-test-identity', who)
    .send({ name })
    .expect(201)

  return answer.body as TagRow
}

async function tagsOf(who = office()): Promise<TagRow[]> {
  const answer = await http().get('/customers/tags').set('x-test-identity', who).expect(200)

  return answer.body as TagRow[]
}

function tag(
  record: { readonly customerId: string } | { readonly siteId: string },
  body: Record<string, unknown>,
  expected = 200,
  who = office(),
) {
  const path =
    'customerId' in record ? `/customers/${record.customerId}/tags` : `/sites/${record.siteId}/tags`

  return http().put(path).set('x-test-identity', who).send(body).expect(expected)
}

/** The tags a customer or site has, as the database holds them. */
async function heldBy(table: 'customer_tags' | 'site_tags', column: string, id: string) {
  const { rows } = await admin.query<{ name: string }>(
    `select t.name from ${table} x join tags t on t.id = x.tag_id
      where x.${column} = $1 and x.deleted_at is null order by t.name`,
    [id],
  )

  return rows.map((row) => row.name)
}

interface Pulled {
  readonly changes: { entity: string; rows: Record<string, unknown>[] }[]
}

async function pull(who: string) {
  const answer = await http().get('/sync?since=0').set('x-test-identity', who).expect(200)

  return answer.body as Pulled
}

function rowsOf(pulled: Pulled, entity: string) {
  return (pulled.changes.find((change) => change.entity === entity)?.rows ?? []).filter(
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

describe('the tags of a business', () => {
  it('are made with a tidy name, listed by name, renamed and deleted', async () => {
    const wallbox = await makeTag('  Wallbox ')
    const smart = await makeTag('Smart   Home')

    expect(wallbox.name).toBe('Wallbox')
    expect(smart.name).toBe('Smart Home')
    expect((await tagsOf()).map((row) => row.name)).toEqual(['Smart Home', 'Wallbox'])

    const renamed = await http()
      .patch(`/customers/tags/${smart.id}`)
      .set('x-test-identity', office())
      .send({ name: 'Smart-Home' })
      .expect(200)

    expect((renamed.body as TagRow).name).toBe('Smart-Home')

    await http().delete(`/customers/tags/${smart.id}`).set('x-test-identity', office()).expect(200)

    expect((await tagsOf()).map((row) => row.name)).toEqual(['Wallbox'])

    // Deleted, the name is free again.
    expect((await makeTag('Smart-Home')).id).not.toBe(smart.id)
  })

  it('keep a name once, whatever its case, and say which tag has it', async () => {
    await makeTag('Rahmenvertrag')

    const taken = await http()
      .post('/customers/tags')
      .set('x-test-identity', office())
      .send({ name: 'rahmenvertrag' })
      .expect(409)

    expect((taken.body as { message: string }).message).toBe(
      'Den Tag „Rahmenvertrag“ gibt es schon.',
    )

    const other = await makeTag('Photovoltaik')

    await http()
      .patch(`/customers/tags/${other.id}`)
      .set('x-test-identity', office())
      .send({ name: 'RAHMENVERTRAG' })
      .expect(409)

    // Its own name in another case is no clash.
    await http()
      .patch(`/customers/tags/${other.id}`)
      .set('x-test-identity', office())
      .send({ name: 'PHOTOVOLTAIK' })
      .expect(200)
  })

  it('refuse a name that is empty or too long, in words', async () => {
    const empty = await http()
      .post('/customers/tags')
      .set('x-test-identity', office())
      .send({ name: '   ' })
      .expect(422)

    expect((empty.body as { message: string }).message).toBe('Ein Tag braucht einen Namen.')

    await http()
      .post('/customers/tags')
      .set('x-test-identity', office())
      .send({ name: 'x'.repeat(41) })
      .expect(422)
  })

  it('are made by whoever may change customers, not by a technician', async () => {
    await http()
      .post('/customers/tags')
      .set('x-test-identity', technician())
      .send({ name: 'Baustelle' })
      .expect(403)

    // Reading them is part of reading customers.
    await http().get('/customers/tags').set('x-test-identity', technician()).expect(200)
  })
})

describe('the tags of a customer and a site', () => {
  it('are set as the whole list, a new name made into a tag or found as one', async () => {
    const customerId = await post('/customers', { kind: 'business', name: 'Autohaus Brenner OHG' })
    const wallbox = (await tagsOf()).find((row) => row.name === 'Wallbox') as TagRow

    const first = await tag(
      { customerId },
      { tagIds: [wallbox.id], newTags: ['Gewerbe Nord', 'wallbox'] },
    )

    expect(await heldBy('customer_tags', 'customer_id', customerId)).toEqual([
      'Gewerbe Nord',
      'Wallbox',
    ])
    expect((first.body as { tagIds: string[] }).tagIds).toHaveLength(2)

    // Taken off by leaving it out; put on again, it is a new row.
    await tag({ customerId }, { tagIds: [wallbox.id] })
    expect(await heldBy('customer_tags', 'customer_id', customerId)).toEqual(['Wallbox'])

    const { rows } = await admin.query<{ removed: number }>(
      `select count(*)::int as removed from customer_tags
        where customer_id = $1 and deleted_at is not null`,
      [customerId],
    )

    expect(rows).toEqual([{ removed: 1 }])
  })

  it('refuse a tag that was deleted in the meantime', async () => {
    const customerId = await post('/customers', { kind: 'private', name: 'Weber, Familie' })
    const gone = await makeTag('Altbau')

    await http().delete(`/customers/tags/${gone.id}`).set('x-test-identity', office()).expect(200)

    const refused = await tag({ customerId }, { tagIds: [gone.id] }, 422)

    expect((refused.body as { message: string }).message).toContain('gibt es nicht mehr')
  })

  it('go with the tag when it is deleted, from customers and sites alike', async () => {
    const customerId = await post('/customers', { kind: 'private', name: 'Kern, Ingrid' })
    const siteId = await post('/sites', { customerId, designation: 'Haus Kern' })
    const pv = await makeTag('PV Süd')

    await tag({ customerId }, { tagIds: [pv.id] })
    await tag({ siteId }, { tagIds: [pv.id] })

    expect(await heldBy('site_tags', 'site_id', siteId)).toEqual(['PV Süd'])

    await http().delete(`/customers/tags/${pv.id}`).set('x-test-identity', office()).expect(200)

    expect(await heldBy('customer_tags', 'customer_id', customerId)).toEqual([])
    expect(await heldBy('site_tags', 'site_id', siteId)).toEqual([])
  })

  it('are set by whoever may change the record, not by a technician', async () => {
    const customerId = await post('/customers', { kind: 'private', name: 'Lang, Metzgerei' })

    await tag({ customerId }, { tagIds: [], newTags: ['Metzgerei'] }, 403, technician())
  })
})

describe('the tags of a record at the same moment', () => {
  /**
   * Two whole lists for one customer at once: one comes after the other, and
   * the customer ends with the second, not with both. A connection holds the
   * customer until both have arrived, so that they meet for certain.
   */
  it('take one list after the other, not the two together', async () => {
    const customerId = await post('/customers', { kind: 'business', name: 'Zweimal GmbH' })
    const first = await makeTag('Erster Stand')
    const second = await makeTag('Zweiter Stand')
    const holding = await admin.connect()

    try {
      await holding.query('begin')
      await holding.query('select id from customers where id = $1 for update', [customerId])

      const both = Promise.all([
        tag({ customerId }, { tagIds: [first.id] }).then((answer) => answer),
        tag({ customerId }, { tagIds: [second.id] }).then((answer) => answer),
      ])

      await new Promise((resolve) => setTimeout(resolve, 300))
      await holding.query('commit')

      expect((await both).map((answer) => answer.status)).toEqual([200, 200])
    } finally {
      holding.release()
    }

    expect(await heldBy('customer_tags', 'customer_id', customerId)).toHaveLength(1)
  })

  /**
   * A tag deleted while it is being put on: the deletion holds the tag, the
   * list waits for it and then finds the tag gone, instead of putting on a
   * tag whose deletion never saw the new assignment.
   */
  it('refuse a tag deleted while it is put on', async () => {
    const customerId = await post('/customers', { kind: 'business', name: 'Gleichzeitig AG' })
    const going = await makeTag('Geht gerade')
    const deleting = await admin.connect()

    try {
      await deleting.query('begin')
      await deleting.query('update tags set deleted_at = now() where id = $1', [going.id])

      const putting = tag({ customerId }, { tagIds: [going.id] }, 422).then((answer) => answer)

      await new Promise((resolve) => setTimeout(resolve, 300))
      await deleting.query('commit')

      expect(((await putting).body as { message: string }).message).toContain('gibt es nicht mehr')
    } finally {
      deleting.release()
    }

    expect(await heldBy('customer_tags', 'customer_id', customerId)).toEqual([])
  })
})

describe('the tags of a deleted record', () => {
  it('go with it, from customers and sites alike', async () => {
    const customerId = await post('/customers', { kind: 'private', name: 'Weg, Familie' })
    const siteId = await post('/sites', { customerId, designation: 'Haus Weg' })
    const kept = await makeTag('Bleibt')

    await tag({ customerId }, { tagIds: [kept.id] })
    await tag({ siteId }, { tagIds: [kept.id] })

    await http().delete(`/sites/${siteId}`).set('x-test-identity', office()).expect(200)
    await http().delete(`/customers/${customerId}`).set('x-test-identity', office()).expect(200)

    expect(await heldBy('customer_tags', 'customer_id', customerId)).toEqual([])
    expect(await heldBy('site_tags', 'site_id', siteId)).toEqual([])
    expect((await tagsOf()).map((row) => row.name)).toContain('Bleibt')
  })
})

describe('a tag and the business it was made in', () => {
  it('stays in it: another business neither sees, renames, deletes nor uses it', async () => {
    const ours = await makeTag('Nur im Norden')
    const theirCustomer = await post(
      '/customers',
      { kind: 'private', name: 'Süd, Kunde' },
      neighbour(),
    )

    expect((await tagsOf(neighbour())).map((row) => row.id)).not.toContain(ours.id)

    await http()
      .patch(`/customers/tags/${ours.id}`)
      .set('x-test-identity', neighbour())
      .send({ name: 'Übernommen' })
      .expect(404)
    await http()
      .delete(`/customers/tags/${ours.id}`)
      .set('x-test-identity', neighbour())
      .expect(404)
    await tag({ customerId: theirCustomer }, { tagIds: [ours.id] }, 422, neighbour())

    // The same name is free in the other business.
    expect((await makeTag('Nur im Norden', neighbour())).id).not.toBe(ours.id)
  })

  it('cannot be put on a record of another business, not even beside the routes', async () => {
    const ours = await makeTag('Grenze')
    const theirCustomer = await post(
      '/customers',
      { kind: 'private', name: 'Süd, Grenzfall' },
      neighbour(),
    )

    await expect(
      admin.query(
        'insert into customer_tags (tenant_id, customer_id, tag_id) values ($1, $2, $3)',
        [south.id, theirCustomer, ours.id],
      ),
    ).rejects.toThrow(/customer_tags_tag_in_tenant/)
  })
})

describe('the tags on a device', () => {
  it('come with the sync: every tag, and the tags of what the device holds', async () => {
    const customerId = await post('/customers', { kind: 'business', name: 'Stadtwerke' })
    const siteId = await post('/sites', { customerId, designation: 'Umspannwerk' })
    const framework = (await tagsOf()).find((row) => row.name === 'Rahmenvertrag') as TagRow

    await tag({ customerId }, { tagIds: [framework.id] })
    await tag({ siteId }, { tagIds: [framework.id] })

    const pulled = await pull(office())

    expect(rowsOf(pulled, 'tags').map((row) => row['name'])).toContain('Rahmenvertrag')
    expect(rowsOf(pulled, 'customer_tags')).toContainEqual(
      expect.objectContaining({ customerId, tagId: framework.id }),
    )
    expect(rowsOf(pulled, 'site_tags')).toContainEqual(
      expect.objectContaining({ siteId, tagId: framework.id }),
    )

    // A technician on no job holds every tag and no customer's.
    const theirs = await pull(technician())

    expect(rowsOf(theirs, 'tags').map((row) => row['name'])).toContain('Rahmenvertrag')
    expect(rowsOf(theirs, 'customer_tags')).toEqual([])
    expect(rowsOf(theirs, 'site_tags')).toEqual([])
  })

  it('come to a technician for the customer and site they made themselves', async () => {
    const customerId = await post(
      '/customers',
      { kind: 'private', name: 'Vor Ort, Neukunde' },
      technician(),
    )
    const siteId = await post('/sites', { customerId, designation: 'Vor Ort' }, office())
    const found = await makeTag('Vor Ort gefunden')

    await tag({ customerId }, { tagIds: [found.id] })
    await tag({ siteId }, { tagIds: [found.id] })

    const theirs = await pull(technician())

    // The customer is on the device because its person made it, and its tag with it.
    expect(rowsOf(theirs, 'customers').map((row) => row['id'])).toContain(customerId)
    expect(rowsOf(theirs, 'customer_tags')).toContainEqual(
      expect.objectContaining({ customerId, tagId: found.id }),
    )
    // The office made the site, so it is not, and neither is its tag.
    expect(rowsOf(theirs, 'site_tags')).toEqual([])
  })

  it('are not written by a device', async () => {
    const answer = await push(app, office(), [
      created('tags', newId<'tag'>(), { name: 'Vom Gerät' }),
    ])

    expect(answer.receipts.map((receipt) => receipt.outcome)).toEqual(['conflict'])
    expect(JSON.stringify(answer.receipts)).toContain('online_only')
    expect((await tagsOf()).map((row) => row.name)).not.toContain('Vom Gerät')
  })
})
