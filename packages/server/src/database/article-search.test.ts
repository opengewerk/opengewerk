import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Database, newId } from '@opengewerk/platform-server'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { as, testIdentities as identities } from '../api/test-identity.js'
import {
  applicationDatabaseUrl,
  connect,
  ownerDatabaseUrl,
  resetToMigrated,
} from './test-database.js'

/**
 * The search over the catalogue (#461, ADR 0015): a table outside FORCE that
 * the application has no right on, written by the triggers of the articles and
 * their suppliers' numbers, and read only through `article_search_hits`, which
 * asks for the business itself.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let application: Pool
let database: Database
let app: INestApplication

const office = as(north.id, 'office')
const southOffice = as(south.id, 'office')

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'patch' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
  who = office,
) {
  const answer = await http()
    [method](path)
    .set('x-test-identity', who)
    .send(body)
    .expect(method === 'post' ? 201 : 200)

  return answer.body as { id: string }
}

/** The numbers the list shows for a search, as the office sees it. */
async function found(search: string, who = office): Promise<string[]> {
  const answer = await http()
    .get(`/articles?search=${encodeURIComponent(search)}`)
    .set('x-test-identity', who)
    .expect(200)

  return (answer.body as { rows: { number: string }[] }).rows.map((row) => row.number)
}

/** What the function itself finds, asked as the application in a business, or in none. */
async function hits(pattern: string, tenantId: string | null): Promise<string[]> {
  const client = await application.connect()

  try {
    await client.query('begin')

    if (tenantId !== null) {
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    }

    const { rows } = await client.query<{ hit: string }>(
      'select hit from article_search_hits($1) as hit order by hit',
      [pattern],
    )

    return rows.map((row) => row.hit)
  } finally {
    await client.query('rollback')
    client.release()
  }
}

async function article(
  number: string,
  designation: string,
  extra: Record<string, unknown> = {},
  who = office,
) {
  return (await send('post', '/articles', { number, designation, unit: 'piece', ...extra }, who)).id
}

let supplier = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])
  application = new Pool({ connectionString: applicationDatabaseUrl(), max: 2 })
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
  supplier = (await send('post', '/suppliers', { name: 'Elektro-Großhandel Rhein-Neckar GmbH' })).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await application.end()
  await admin.end()
})

describe('the search table', () => {
  it('is not open to the application, which reaches it only through its function', async () => {
    await expect(application.query('select * from article_search')).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      application.query(`insert into article_search (id, tenant_id, article_id, text)
        values (uuidv7(), '${north.id}', uuidv7(), 'x')`),
    ).rejects.toThrow(/permission denied/)
  })

  it('finds the articles of the business of the transaction, none of another, and nothing without one', async () => {
    const ours = await article('SR-100', 'Schutzrohr flexibel M20')
    const theirs = await article('SR-100', 'Schutzrohr flexibel M20', {}, southOffice)

    expect(await hits('%schutzrohr%', north.id)).toEqual([ours])
    expect(await hits('%schutzrohr%', south.id)).toEqual([theirs])
    expect(await hits('%schutzrohr%', null)).toEqual([])
    expect(await found('Schutzrohr')).toEqual(['SR-100'])
    expect(await found('Schutzrohr', southOffice)).toEqual(['SR-100'])
  })

  it('follows an article: made, renamed, marked deleted and back', async () => {
    const id = await article('AD-85', 'Abzweigdose AP 85', { ean: '4012345678901' })

    expect(await hits('%abzweigdose%', north.id)).toEqual([id])
    expect(await hits('%4012345678901%', north.id)).toEqual([id])
    expect(await hits('%ad-85%', north.id)).toEqual([id])

    await send('patch', `/articles/${id}`, { designation: 'Feuchtraum-Verbindungsdose 100' })

    expect(await hits('%abzweigdose%', north.id)).toEqual([])
    expect(await hits('%verbindungsdose%', north.id)).toEqual([id])

    await send('delete', `/articles/${id}`)

    expect(await hits('%verbindungsdose%', north.id)).toEqual([])

    // No route takes the mark back; a migration or a later one may, and the
    // row has to come with it.
    await admin.query('update articles set deleted_at = null where id = $1', [id])

    expect(await hits('%verbindungsdose%', north.id)).toEqual([id])
  })

  it("follows a supplier's number: linked, changed, taken away, and gone with the link", async () => {
    const id = await article('KK-40', 'Kabelkanal 40 × 60')
    const link = (
      await send('post', `/articles/${id}/suppliers`, {
        supplierId: supplier,
        supplierNumber: 'RN-778812',
      })
    ).id

    expect(await hits('%rn-7788%', north.id)).toEqual([id])

    await send('patch', `/articles/${id}/suppliers/${link}`, { supplierNumber: 'RN-990001' })

    expect(await hits('%rn-7788%', north.id)).toEqual([])
    expect(await hits('%rn-9900%', north.id)).toEqual([id])

    await send('patch', `/articles/${id}/suppliers/${link}`, { supplierNumber: null })

    expect(await hits('%rn-9900%', north.id)).toEqual([])

    await send('patch', `/articles/${id}/suppliers/${link}`, { supplierNumber: 'RN-123456' })
    await send('delete', `/articles/${id}/suppliers/${link}`)

    expect(await hits('%rn-1234%', north.id)).toEqual([])
    expect(
      await admin.query('select 1 from article_search where supplier_article_id = $1', [link]),
    ).toMatchObject({
      rowCount: 0,
    })
  })

  it('finds an article by the name of a supplier, which the table does not hold', async () => {
    const id = await article('LS-B16', 'Leitungsschutzschalter B16')
    await send('post', `/articles/${id}/suppliers`, { supplierId: supplier })

    expect(await found('Rhein-Neckar')).toContain('LS-B16')
  })
})

/**
 * A catalogue the size of a wholesaler's, as #461 measured it: 700,000
 * articles of one business with a supplier's number each, and a few of
 * another. Written past the triggers, then copied over the way 0103 copies
 * what exists, so that it takes seconds and not minutes.
 */
describe('a catalogue of 700,000 articles', () => {
  const catalogue = 700_000

  beforeAll(async () => {
    // One connection: the triggers stay off only on the session that says so.
    const client = await admin.connect()

    try {
      await client.query(`set session_replication_role = replica`)
      await client.query(
        `insert into articles (tenant_id, number, designation, unit, ean, group_of_goods)
         select $1, lpad((g::bigint * 7919 % 9999991)::text, 7, '0'),
                (array['Mantelleitung NYM-J', 'Aderleitung H07V-K', 'Abzweigdose AP', 'Schutzkontaktsteckdose',
                       'Leitungsschutzschalter', 'Kabelkanal', 'Installationsrohr', 'Bewegungsmelder'])[1 + g % 8]
                  || ' ' || (g % 977)::text || ' ' || md5(g::text),
                'piece', case when g % 4 = 0 then null else (4000000000000 + g::bigint * 104729 % 999999999999)::text end,
                'G' || (g % 40)::text
           from generate_series(1, $2::int) g`,
        [north.id, catalogue],
      )
      await client.query(
        `insert into supplier_articles (tenant_id, article_id, supplier_id, supplier_number, main)
         select tenant_id, id, $2, 'R' || number, false from articles where tenant_id = $1 and number ~ '^[0-9]{7}$'`,
        [north.id, supplier],
      )
      await client.query(`set session_replication_role = origin`)
      await client.query(
        `insert into article_search (id, tenant_id, article_id, text)
         select id, tenant_id, id, lower(number || ' ' || designation || coalesce(' ' || ean, ''))
           from articles a
          where deleted_at is null and not exists (select 1 from article_search s where s.id = a.id)`,
      )
      await client.query(
        `insert into article_search (id, tenant_id, article_id, supplier_article_id, text)
         select id, tenant_id, article_id, id, lower(supplier_number)
           from supplier_articles sa
          where coalesce(supplier_number, '') <> ''
            and not exists (select 1 from article_search s where s.id = sa.id)`,
      )
      await client.query('vacuum analyze articles, supplier_articles, article_search')
    } finally {
      await client.query(`set session_replication_role = origin`)
      client.release()
    }
  }, 300_000)

  async function timed(
    path: string,
  ): Promise<{ ms: number; body: { total: number; rows: unknown[] } }> {
    const started = performance.now()
    const answer = await http().get(path).set('x-test-identity', office).expect(200)

    return {
      ms: performance.now() - started,
      body: answer.body as { total: number; rows: unknown[] },
    }
  }

  it('is searched through the trigram index, not row by row', async () => {
    // The question of `article_search_hits`, asked the way it runs: as the
    // owner, past the policy. A plan that reads the table whole is the search
    // of before #461 again.
    const owner = new Pool({ connectionString: ownerDatabaseUrl(), max: 1 })

    try {
      const { rows } = await owner.query<{ 'QUERY PLAN': string }>(
        `explain select distinct article_id from article_search
          where tenant_id = $1 and text like lower('%abzweigdose ap 512%')`,
        [north.id],
      )
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n')

      expect(plan).toContain('article_search_text')
      expect(plan).not.toMatch(/Seq Scan on article_search/)
    } finally {
      await owner.end()
    }
  })

  it('finds part of a name, a number or an EAN within the time a typing person waits', async () => {
    const byName = await timed(`/articles?search=${encodeURIComponent('Abzweigdose AP 512 ')}`)
    const byNumber = await timed('/articles?search=0007919')
    const byEan = await timed('/articles?search=4000000104729')

    expect(byName.body.total).toBeGreaterThan(0)
    expect(byNumber.body.total).toBeGreaterThan(0)
    expect(byEan.body.total).toBeGreaterThan(0)
    // 300 ms is the mark of #461, and the workstation needs 10 to 30 ms for
    // these; the runners of the CI are slower, and what this guards against
    // took 1.35 s on the workstation.
    for (const search of [byName, byNumber, byEan]) {
      expect(search.ms).toBeLessThan(1000)
    }
  })

  it('shows every page within the time, the last one too, by number and by name', async () => {
    const last = Math.floor((catalogue - 1) / 50) * 50

    for (const sort of ['number', 'designation']) {
      const first = await timed(`/articles?sort=${sort}&limit=50&offset=0`)
      const end = await timed(`/articles?sort=${sort}&limit=50&offset=${String(last)}`)

      expect(first.body.rows).toHaveLength(50)
      expect(end.body.rows.length).toBeGreaterThan(0)
      // 500 ms is the mark of #461, and the workstation needs 0.16 s; the last
      // page took 5.5 s before.
      expect(end.ms).toBeLessThan(1000)
    }
  })
})
