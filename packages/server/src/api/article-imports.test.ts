import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { ArticleImport, IsoDate } from '@opengewerk/domain'
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
  resetSchema,
} from '../database/test-database.js'
import { ArticleImports, endInterruptedImports } from '../datanorm/imports.js'
import { cp850, header, zipOf } from '../datanorm/test-files.js'
import { FileStore } from '../storage/file-store.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'

/**
 * Imports from DATANORM through the routes (#297): the preview that writes
 * nothing, the takeover in one piece with one record in the log, a second
 * import of the same files that finds nothing to do, price files, deletions,
 * a takeover that breaks off halfway and leaves nothing behind, and the
 * imports a restart cut off.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

const office = as(north.id, 'office')
const technician = as(north.id, 'technician')
const elsewhere = as(south.id, 'owner')

/** The day the tests take for today: before the day of the files. */
const today = '2026-09-28' as IsoDate

let admin: Pool
let database: Database
let app: INestApplication
let imports: ArticleImports
let storageRoot: string

let hansa = ''
let cable = ''
let other = ''
let breaker = ''

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'patch',
  path: string,
  body: Record<string, unknown>,
  status: number,
  who = office,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body).expect(status)

  return answer.body as Record<string, unknown> & { id: string; message?: string }
}

async function get(path: string, who = office, status = 200) {
  const answer = await http().get(path).set('x-test-identity', who).expect(status)

  return answer.body as unknown
}

async function upload(bytes: Uint8Array): Promise<string> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  await http()
    .put(`/files/${sha256}`)
    .set('x-test-identity', office)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Media-Type', 'application/octet-stream')
    .send(Buffer.from(bytes))
    .expect(200)

  return sha256
}

/** Uploads the files, starts the import and waits for its preview. */
async function preview(files: readonly { name: string; bytes: Uint8Array }[]) {
  const named = []

  for (const file of files) {
    named.push({ name: file.name, sha256: await upload(file.bytes) })
  }

  const started = (await send(
    'post',
    `/suppliers/${hansa}/imports`,
    { files: named },
    202,
  )) as unknown as ArticleImport

  expect(started.status).toBe('reading')
  await imports.settled()

  return (await get(`/suppliers/${hansa}/imports/${started.id}`)) as ArticleImport
}

async function takeOver(id: string) {
  const applying = (await send(
    'post',
    `/suppliers/${hansa}/imports/${id}/apply`,
    {},
    202,
  )) as unknown as ArticleImport

  expect(applying.status).toBe('applying')
  await imports.settled()

  return (await get(`/suppliers/${hansa}/imports/${id}`)) as ArticleImport
}

async function count(query: string, values: unknown[] = []): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(query, values)

  return Number(rows[0]?.count)
}

/** Entries of the log about the article tables, which an import does not write. */
function articleEntries(): Promise<number> {
  return count(
    `select count(*) from audit_entries
      where tenant_id = $1
        and table_name in ('articles', 'article_prices', 'supplier_articles', 'purchase_prices', 'list_prices')`,
    [north.id],
  )
}

const catalogue = cp850([
  header('011026'),
  // Sold by the supplier already: a new list price per 1000 metres.
  'A;N;5700123;00;Mantelleitung NYM-J;3 × 1,5 mm²;1;3;m;98000;RG12;042;;',
  // New, under a number the business uses for something else.
  'A;N;5709912;00;Kabelbinder 200x4,8;schwarz UV;1;2;Stck;350;RG30;042;;',
  // An article of the business, found by its EAN.
  'A;N;6100001;00;Leitungsschutzschalter B16;1-polig;1;0;Stck;1290;RG20;051;;',
  'B;N;6100001; ; ; ;;;;4006381333948; ;0510;0;0; ; ;',
  // New, with a net price only.
  'A;N;6200002;00;Abzweigdose;AP 80x80 grau;2;0;Stck;145;RG30;042;;',
  // Deleted, but never sold here.
  'A;L;7300003;00;Alt;;1;0;Stck;100;;;;',
])

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

  database = Database.connect(applicationDatabaseUrl())
  storageRoot = mkdtempSync(join(tmpdir(), 'opengewerk-imports-'))

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities, { files: new FileStore(storageRoot) })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
  imports = app.get(ArticleImports)
  imports.today = () => today

  hansa = (await send('post', '/suppliers', { name: 'Elektro-Großhandel Hansa' }, 201)).id
  cable = (
    await send(
      'post',
      '/articles',
      {
        number: '1042',
        designation: 'Mantelleitung NYM-J 3 × 1,5 mm²',
        ean: '4006381333931',
        unit: 'metre',
        frequent: true,
        price: { unitPriceCents: 92, validFrom: '2026-03-01' },
      },
      201,
    )
  ).id
  other = (
    await send(
      'post',
      '/articles',
      { number: '5709912', designation: 'Anderes', unit: 'piece' },
      201,
    )
  ).id
  breaker = (
    await send(
      'post',
      '/articles',
      {
        number: '2101',
        designation: 'Leitungsschutzschalter B16, 1-polig',
        ean: '4006381333948',
        unit: 'piece',
        price: { unitPriceCents: 890, validFrom: '2026-01-01' },
      },
      201,
    )
  ).id
  await send(
    'post',
    `/articles/${cable}/suppliers`,
    {
      supplierId: hansa,
      supplierNumber: '5700123',
      price: { unitPriceCents: 54, validFrom: '2026-03-01' },
    },
    201,
  )
})

afterAll(async () => {
  await imports.settled()
  await app.close()
  await database.close()
  await admin.end()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('an import from DATANORM', () => {
  let first = ''

  it('reads the files into a preview and writes nothing yet', async () => {
    const articlesBefore = await count('select count(*) from articles where tenant_id = $1', [
      north.id,
    ])
    const read = await preview([
      { name: 'hansa.zip', bytes: zipOf([{ name: 'DATANORM.001', bytes: catalogue }]) },
    ])

    first = read.id
    expect(read).toMatchObject({
      status: 'ready',
      validFrom: '2026-10-01',
      listAsSelling: true,
      problem: null,
      progress: null,
    })
    expect(read.summary).toMatchObject({
      articles: 4,
      created: 2,
      linked: 1,
      updated: 1,
      unchanged: 0,
      removed: 0,
      renumbered: 1,
      shortCode: 'ELE',
      fileDate: '2026-10-01',
      files: [{ name: 'DATANORM.001', charset: 'cp850', lines: 7 }],
    })
    expect(read.summary?.samples.map((sample) => [sample.kind, sample.number])).toEqual([
      ['updated', '1042'],
      ['created', '5709912-ELE'],
      ['linked', '2101'],
      ['created', '6200002'],
    ])
    expect(await count('select count(*) from articles where tenant_id = $1', [north.id])).toBe(
      articlesBefore,
    )
  })

  it('takes the preview over in one piece, with one record in the log', async () => {
    const entriesBefore = await articleEntries()
    const { rows: counter } = await admin.query<{ next_value: string }>(
      'select next_value from sync_sequences where tenant_id = $1',
      [north.id],
    )
    const cursor = Number(counter[0]?.next_value)

    const applied = await takeOver(first)

    expect(applied).toMatchObject({ status: 'applied', problem: null, progress: null })
    expect(applied.appliedAt).not.toBeNull()
    expect(applied.summary).toMatchObject({ created: 2, linked: 1, updated: 1 })

    const { rows: created } = await admin.query<{
      number: string
      unit: string
      import_id: string
    }>('select number, unit, import_id from articles where import_id is not null order by number')
    expect(created).toEqual([
      { number: '5709912-ELE', unit: 'piece', import_id: first },
      { number: '6200002', unit: 'piece', import_id: first },
    ])

    const { rows: links } = await admin.query<{
      supplier_number: string
      number: string
      discount_group: string
    }>(
      `select s.supplier_number, a.number, s.discount_group
         from supplier_articles s join articles a on a.id = s.article_id
        where s.supplier_id = $1 order by s.supplier_number`,
      [hansa],
    )
    expect(links).toEqual([
      { supplier_number: '5700123', number: '1042', discount_group: 'RG12' },
      { supplier_number: '5709912', number: '5709912-ELE', discount_group: 'RG30' },
      { supplier_number: '6100001', number: '2101', discount_group: 'RG20' },
      { supplier_number: '6200002', number: '6200002', discount_group: 'RG30' },
    ])

    const { rows: lists } = await admin.query<{
      supplier_number: string
      cents: number
      base: number
    }>(
      `select s.supplier_number, l.unit_price_cents as cents, l.price_base as base
         from list_prices l join supplier_articles s on s.id = l.supplier_article_id
        where l.valid_from = '2026-10-01' order by s.supplier_number`,
    )
    expect(lists).toEqual([
      { supplier_number: '5700123', cents: 98000, base: 1000 },
      { supplier_number: '5709912', cents: 350, base: 100 },
      { supplier_number: '6100001', cents: 1290, base: 1 },
    ])

    const { rows: selling } = await admin.query<{ number: string; cents: number; base: number }>(
      `select a.number, p.unit_price_cents as cents, p.price_base as base
         from article_prices p join articles a on a.id = p.article_id
        where p.valid_from = '2026-10-01' and p.deleted_at is null order by a.number`,
    )
    expect(selling).toEqual([
      { number: '1042', cents: 98000, base: 1000 },
      { number: '2101', cents: 1290, base: 1 },
      { number: '5709912-ELE', cents: 350, base: 100 },
    ])

    expect(
      await count(
        `select count(*) from purchase_prices p join supplier_articles s on s.id = p.supplier_article_id
          where s.supplier_number = '6200002' and p.unit_price_cents = 145`,
      ),
    ).toBe(1)

    // The short code the renumbered article got is the supplier's now.
    const { rows: supplier } = await admin.query<{ short_code: string }>(
      'select short_code from suppliers where id = $1',
      [hansa],
    )
    expect(supplier[0]?.short_code).toBe('ELE')

    // Not one entry per field: the rows of the import are its record.
    expect(await articleEntries()).toBe(entriesBefore)
    expect(
      await count(
        `select count(*) from audit_entries
          where table_name = 'article_imports' and record_id = $1 and field = 'status'`,
        [first],
      ),
    ).toBeGreaterThanOrEqual(3)

    // Every synced row has its own number after the run it took, none is left below zero.
    const { rows: numbers } = await admin.query<{ change_sequence: string }>(
      `select change_sequence from articles where import_id = $1
        union all
       select change_sequence from article_prices where import_id = $1`,
      [first],
    )
    const taken = numbers.map((row) => Number(row.change_sequence))

    expect(taken).toHaveLength(5)
    expect(new Set(taken).size).toBe(5)
    expect(Math.min(...taken)).toBeGreaterThan(cursor)
    expect(await count('select count(*) from articles where change_sequence < 0')).toBe(0)
    expect(await count('select count(*) from article_prices where change_sequence < 0')).toBe(0)

    // A device on the cable, a frequent article, gets its new selling price.
    const pulled = await http()
      .get(`/sync?since=${String(cursor)}`)
      .set('x-test-identity', office)
      .expect(200)
    const prices =
      (
        pulled.body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
      ).changes.find((change) => change.entity === 'article_prices')?.rows ?? []
    expect(prices).toEqual([
      expect.objectContaining({ articleId: cable, unitPriceCents: 98000, priceBase: 1000 }),
    ])
  })

  it('finds nothing to do in the same files a second time', async () => {
    const again = await preview([{ name: 'DATANORM.001', bytes: catalogue }])

    expect(again.summary).toMatchObject({ created: 0, linked: 0, updated: 0, unchanged: 4 })

    const refused = await send('post', `/suppliers/${hansa}/imports/${again.id}/apply`, {}, 409)

    expect(refused.message).toBe('In diesem Import gibt es nichts zu übernehmen.')
    await send('post', `/suppliers/${hansa}/imports/${again.id}/discard`, {}, 200)
  })

  it('takes the prices of a price file, and a price of its own day gives way', async () => {
    const prices = await preview([
      { name: 'DATPREIS.001', bytes: cp850([header('011026'), 'P;A;5700123;1;99500;0;RG12;;;;;']) },
    ])

    expect(prices.summary).toMatchObject({ articles: 1, updated: 1 })

    await takeOver(prices.id)

    const { rows: lists } = await admin.query<{ cents: number; base: number }>(
      `select l.unit_price_cents as cents, l.price_base as base
         from list_prices l join supplier_articles s on s.id = l.supplier_article_id
        where s.supplier_number = '5700123' and l.valid_from = '2026-10-01'`,
    )
    expect(lists).toEqual([{ cents: 99500, base: 1000 }])

    // The selling price of that day is marked and not removed, and the new one follows it.
    const { rows: selling } = await admin.query<{
      cents: number
      deleted: boolean
      version: number
      change_sequence: string
    }>(
      `select unit_price_cents as cents, deleted_at is not null as deleted, version, change_sequence
         from article_prices where article_id = $1 and valid_from = '2026-10-01'
        order by unit_price_cents`,
      [cable],
    )
    expect(selling.map(({ cents, deleted, version }) => ({ cents, deleted, version }))).toEqual([
      { cents: 98000, deleted: true, version: 2 },
      { cents: 99500, deleted: false, version: 1 },
    ])
    expect(selling.every((row) => Number(row.change_sequence) > 0)).toBe(true)
  })

  it('leaves the texts of the articles of the business as they are', async () => {
    const { rows } = await admin.query<{ id: string; designation: string }>(
      'select id, designation from articles where id = any($1) order by number',
      [[cable, breaker, other]],
    )

    expect(rows).toEqual([
      { id: cable, designation: 'Mantelleitung NYM-J 3 × 1,5 mm²' },
      { id: breaker, designation: 'Leitungsschutzschalter B16, 1-polig' },
      { id: other, designation: 'Anderes' },
    ])
  })

  it('takes the supplier from an article the files delete, and keeps the article', async () => {
    const deleted = await preview([
      {
        name: 'DATANORM.002',
        bytes: cp850([
          header('011026'),
          'A;L;6200002;00;Abzweigdose;AP 80x80 grau;2;0;Stck;145;;;;',
        ]),
      },
    ])

    expect(deleted.summary).toMatchObject({ removed: 1 })
    await takeOver(deleted.id)

    expect(
      await count(`select count(*) from supplier_articles where supplier_number = '6200002'`),
    ).toBe(0)
    expect(await count(`select count(*) from articles where number = '6200002'`)).toBe(1)
    expect(await count('select count(*) from purchase_prices where unit_price_cents = 145')).toBe(0)
  })

  it('leaves everything as it was when the takeover breaks off halfway', async () => {
    // Stands in for a disk that is full or a connection that drops: the list
    // price of the second article is refused after the first is written.
    await admin.query(`
      create function test_refuse_price() returns trigger language plpgsql as $$
      begin
        raise exception 'Die Platte ist voll.';
      end
      $$`)
    await admin.query(`
      create trigger test_refuse_price before insert on list_prices
        for each row when (new.unit_price_cents = 777) execute function test_refuse_price()`)

    try {
      const broken = await preview([
        {
          name: 'DATANORM.003',
          bytes: cp850([
            header('011026'),
            'A;N;8100001;00;Schukosteckdose;reinweiß;1;0;Stck;420;RG40;061;;',
            'A;N;8100002;00;Wippschalter;reinweiß;1;0;Stck;777;RG40;061;;',
          ]),
        },
      ])
      const { rows: counter } = await admin.query<{ next_value: string }>(
        'select next_value from sync_sequences where tenant_id = $1',
        [north.id],
      )
      const entriesBefore = await articleEntries()

      const failed = await takeOver(broken.id)

      expect(failed).toMatchObject({
        status: 'failed',
        problem:
          'Die Übernahme ist abgebrochen. Übernommen wurde nichts, die Artikel sind, wie sie waren.',
      })
      expect(await count('select count(*) from articles where import_id = $1', [broken.id])).toBe(0)
      expect(
        await count(`select count(*) from supplier_articles where supplier_number like '81%'`),
      ).toBe(0)
      expect(await articleEntries()).toBe(entriesBefore)

      const { rows: after } = await admin.query<{ next_value: string }>(
        'select next_value from sync_sequences where tenant_id = $1',
        [north.id],
      )
      expect(after[0]?.next_value).toBe(counter[0]?.next_value)
    } finally {
      await admin.query('drop trigger test_refuse_price on list_prices')
      await admin.query('drop function test_refuse_price()')
    }
  })
})

describe('the options of a preview', () => {
  it('read the files again, and a day in the past is refused', async () => {
    const read = await preview([
      {
        name: 'DATANORM.004',
        bytes: cp850([header('011026'), 'A;N;9100001;00;Klemme;;1;0;Stck;50;;;;']),
      },
    ])

    const past = await send(
      'patch',
      `/suppliers/${hansa}/imports/${read.id}`,
      { validFrom: '2026-09-01' },
      422,
    )
    expect(past.message).toBe('Ein Preis gilt nicht rückwirkend, frühestens ab heute.')

    const changed = (await send(
      'patch',
      `/suppliers/${hansa}/imports/${read.id}`,
      { validFrom: '2026-11-01', listAsSelling: false, charset: 'windows-1252' },
      202,
    )) as unknown as ArticleImport

    expect(changed).toMatchObject({ status: 'reading', validFrom: '2026-11-01', summary: null })
    await imports.settled()

    const again = (await get(`/suppliers/${hansa}/imports/${read.id}`)) as ArticleImport

    expect(again).toMatchObject({
      status: 'ready',
      validFrom: '2026-11-01',
      listAsSelling: false,
      charset: 'windows-1252',
    })
    expect(again.summary?.files).toEqual([
      { name: 'DATANORM.004', charset: 'windows-1252', lines: 2 },
    ])

    // A preview of yesterday cannot be taken over with the day it proposed.
    imports.today = () => '2026-11-02' as IsoDate

    try {
      const late = await send('post', `/suppliers/${hansa}/imports/${read.id}/apply`, {}, 422)

      expect(late.message).toBe('Ein Preis gilt nicht rückwirkend, frühestens ab heute.')
    } finally {
      imports.today = () => today
    }

    await send('post', `/suppliers/${hansa}/imports/${read.id}/discard`, {}, 200)
  })
})

describe('an import that cannot start or run', () => {
  it('is refused for files that were not uploaded, and for a charset it does not know', async () => {
    const missing = await send(
      'post',
      `/suppliers/${hansa}/imports`,
      { files: [{ name: 'DATANORM.001', sha256: 'a'.repeat(64) }] },
      422,
    )
    expect(missing.message).toBe('Die Datei DATANORM.001 ist nicht hochgeladen worden.')

    await send(
      'post',
      `/suppliers/${hansa}/imports`,
      { files: [{ name: 'DATANORM.001', sha256: await upload(catalogue) }], charset: 'latin-9' },
      400,
    )
    await send('post', `/suppliers/${hansa}/imports`, { files: [] }, 400)
  })

  it('fails with a sentence for files that are no DATANORM', async () => {
    const letter = await preview([{ name: 'liesmich.txt', bytes: cp850(['Viel Erfolg!']) }])

    expect(letter).toMatchObject({ status: 'failed', summary: null })
    expect(letter.problem).toMatch(/keine DATANORM-Datei/)
  })

  it('waits while another import runs, and a restart ends one it cut off', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into article_imports (tenant_id, supplier_id, status, files, valid_from)
       values ($1, $2, 'applying', '[]', '2026-10-01') returning id`,
      [north.id, hansa],
    )
    const cutOff = rows[0]?.id ?? ''

    const waiting = await send(
      'post',
      `/suppliers/${hansa}/imports`,
      { files: [{ name: 'DATANORM.001', sha256: await upload(catalogue) }] },
      409,
    )
    expect(waiting.message).toBe(
      'Es läuft schon ein Import. Erst wenn er gelesen oder übernommen ist, lässt sich ein weiterer starten.',
    )

    await endInterruptedImports(database)

    const ended = (await get(`/suppliers/${hansa}/imports/${cutOff}`)) as ArticleImport

    expect(ended).toMatchObject({
      status: 'failed',
      problem:
        'Der Server wurde während der Übernahme neu gestartet. Übernommen wurde nichts, ' +
        'die Artikel sind, wie sie waren.',
    })
  })

  it('belongs to the owner and the office of its business', async () => {
    await get(`/suppliers/${hansa}/imports`, technician, 403)
    await send('post', `/suppliers/${hansa}/imports`, { files: [] }, 403, technician)
    await get(`/suppliers/${hansa}/imports/${newId<'article-import'>()}`, office, 404)

    const listed = (await get(`/suppliers/${hansa}/imports`)) as ArticleImport[]

    expect(listed.length).toBeGreaterThan(3)
    await get(`/suppliers/${hansa}/imports/${listed[0]?.id ?? ''}`, elsewhere, 404)
    expect(await get(`/suppliers/${hansa}/imports`, elsewhere)).toEqual([])
  })
})
