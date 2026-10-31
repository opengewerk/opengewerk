import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { signedContentFingerprint } from '@opengewerk/domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { articlesOnDevices } from '../database/device-scope.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { storesBelowMinimum } from '../deadlines/sources.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities as identities } from './test-identity.js'
import { changed, created, push } from './test-structure.js'

/**
 * The stores of the business (#298, Feature-Gliederung v2.39): a store and a
 * vehicle, the stock made of bookings, a correction as a new booking, a
 * report that books its material when the customer signs it, the minimum and
 * a stock below zero, and what a device holds of it.
 */

const north = { id: newId<'tenant'>(), name: 'Elektro Kohm GmbH' }
const south = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database
let app: INestApplication

const office = as(north.id, 'office')
const technician = as(north.id, 'technician')
const elsewhere = as(south.id, 'office')

const scribble = 'M100,300L200,120L300,280L400,100M520,260L640,180L760,240'

let store = ''
let van = ''
let breaker = ''
let cable = ''
let labour = ''
let customerId = ''
let jobId = ''

function http() {
  return request(app.getHttpServer())
}

async function send(
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
  who = office,
  status = method === 'post' ? 201 : 200,
) {
  const answer = await http()[method](path).set('x-test-identity', who).send(body)

  expect([answer.status, path, answer.body]).toEqual([status, path, expect.anything()])

  return answer.body as Record<string, unknown> & { id: string; message?: string }
}

async function get(path: string, who = office, status = 200) {
  const answer = await http().get(path).set('x-test-identity', who).expect(status)

  return answer.body as Record<string, unknown>
}

interface Held {
  readonly articleId: string
  readonly levelMilli: number
  readonly minimumMilli: number | null
  readonly bin: string | null
}

async function stockOf(storeId: string): Promise<Record<string, Held>> {
  const one = (await get(`/stores/${storeId}`)) as { stock: (Held & { number: string })[] }

  return Object.fromEntries(one.stock.map((row) => [row.number, row]))
}

async function article(number: string, designation: string, unit: string) {
  return (await send('post', '/articles', { number, designation, unit })).id
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    north.id,
    north.name,
    south.id,
    south.name,
  ])
  // Who books is a person of the business.
  await admin.query(
    `insert into auth_users (id, name, email) values ('test', 'Britta Kohm', 'britta@example.de')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, 'test', '{office}'), ($2, 'test', '{office}')`,
    [north.id, south.id],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, identities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  store = (await send('post', '/stores', { name: 'Lager Edingen', location: 'Hauptstraße 103' })).id
  van = (
    await send('post', '/stores', {
      name: 'Transporter HD-OG 412',
      vehicle: true,
      plate: 'HD-OG 412',
    })
  ).id
  breaker = await article('2101', 'Leitungsschutzschalter B16, 1-polig', 'piece')
  cable = await article('1042', 'Mantelleitung NYM-J 3 × 1,5 mm²', 'metre')
  labour = await article('9001', 'Arbeitsstunde Geselle', 'hour')
  customerId = (await send('post', '/customers', { kind: 'private', name: 'Familie Berg' })).id
  jobId = (
    await send('post', '/jobs', {
      customerId,
      kind: 'service',
      designation: 'Unterverteilung Keller',
    })
  ).id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a store', () => {
  it('is kept by the office, a vehicle with its number plate, and read with the articles', async () => {
    const stores = (await get('/stores')) as unknown as {
      name: string
      vehicle: boolean
      plate: string | null
    }[]

    expect(stores.map((row) => [row.name, row.vehicle, row.plate])).toEqual([
      ['Lager Edingen', false, null],
      ['Transporter HD-OG 412', true, 'HD-OG 412'],
    ])

    await send('post', '/stores', { name: 'Caddy' }, technician, 403)
    expect(
      (await send('post', '/stores', { name: 'Halle 2', plate: 'HD-X 1' }, office, 400)).message,
    ).toBe('Ein Kennzeichen hat nur ein Fahrzeug.')
    expect((await send('post', '/stores', { name: '  ' }, office, 400)).message).toBe(
      'Ein Lager braucht einen Namen.',
    )
    await get('/stores', elsewhere).then((rows) => expect(rows).toEqual([]))
  })
})

describe('the stock', () => {
  it('is made of bookings: a receipt adds, a transfer moves, a count sets what was found', async () => {
    await send('post', `/stores/${store}/receipts`, { articleId: cable, quantityMilli: 240_000 })
    await send('post', `/stores/${store}/transfers`, {
      articleId: cable,
      quantityMilli: 50_000,
      toStoreId: van,
    })
    await send('post', `/stores/${van}/counts`, {
      articleId: cable,
      quantityMilli: 48_500,
      reason: 'Rolle im Fahrzeug nachgemessen',
    })

    expect((await stockOf(store))['1042']?.levelMilli).toBe(190_000)
    expect((await stockOf(van))['1042']?.levelMilli).toBe(48_500)

    const moves = (await get(`/stores/${van}/movements`)) as {
      total: number
      rows: {
        kind: string
        quantity_milli: number
        counterpart_name: string | null
        booked_by: string
      }[]
    }

    expect(moves.total).toBe(2)
    expect(
      moves.rows.map((row) => [row.kind, row.quantity_milli, row.counterpart_name, row.booked_by]),
    ).toEqual([
      ['count', 48_500, null, 'test'],
      ['transfer_in', 50_000, 'Lager Edingen', 'test'],
    ])
  })

  it('is booked only by whoever may, for an article a store can keep, and never changed', async () => {
    await send(
      'post',
      `/stores/${store}/receipts`,
      { articleId: cable, quantityMilli: 1000 },
      technician,
      403,
    )
    expect(
      (
        await send(
          'post',
          `/stores/${store}/receipts`,
          { articleId: labour, quantityMilli: 1000 },
          office,
          400,
        )
      ).message,
    ).toBe('Dieser Artikel zählt nicht in einer Menge, die ein Lager führt.')
    expect(
      (
        await send(
          'post',
          `/stores/${van}/counts`,
          { articleId: cable, quantityMilli: 1000 },
          office,
          400,
        )
      ).message,
    ).toBe('Eine Zählung nennt ihren Grund.')
    await expect(
      admin.connect().then(async (client) => {
        try {
          await client.query('set role opengewerk_app')
          await client.query(`select set_config('app.tenant_id', $1, false)`, [north.id])
          await client.query('update stock_movements set quantity_milli = 1')
        } finally {
          await client.query('reset role')
          client.release()
        }
      }),
    ).rejects.toThrow(/permission denied/)
  })

  it('keeps a place and a minimum, lists what lies below it, and gives the office a task for it', async () => {
    await send('put', `/stores/${van}/articles/${breaker}`, {
      bin: 'Schublade 2',
      minimumMilli: 6000,
    })
    await send('post', `/stores/${store}/receipts`, { articleId: breaker, quantityMilli: 20_000 })
    await send('post', `/stores/${store}/transfers`, {
      articleId: breaker,
      quantityMilli: 4000,
      toStoreId: van,
    })

    expect((await stockOf(van))['2101']).toMatchObject({
      levelMilli: 4000,
      minimumMilli: 6000,
      bin: 'Schublade 2',
    })

    const listed = (await get('/stores')) as unknown as { name: string; belowMinimum: number }[]

    expect(listed.find((row) => row.name === 'Transporter HD-OG 412')?.belowMinimum).toBe(1)

    const below = await database.forTenant({ tenantId: north.id }, (tx) => storesBelowMinimum(tx))

    expect(below.map((row) => row.sourceLabel)).toEqual([
      'Leitungsschutzschalter B16, 1-polig im Transporter HD-OG 412',
    ])

    await send('post', `/stores/${store}/transfers`, {
      articleId: breaker,
      quantityMilli: 2000,
      toStoreId: van,
    })

    expect(
      await database.forTenant({ tenantId: north.id }, (tx) => storesBelowMinimum(tx)),
    ).toEqual([])
  })

  it('is not taken away while something lies in it', async () => {
    expect((await send('delete', `/stores/${store}`, {}, office, 409)).message).toBe(
      'Der Lagerort hat noch Bestand. Erst umlagern oder auf null zählen.',
    )
  })
})

describe('a signed report', () => {
  /** A report signed on the device; `later`, its store chosen once the report was begun. */
  async function report(storeId: string | null, later = false) {
    const id = newId<'document'>()
    const introText = 'Unterverteilung erweitert.'
    const lines = [
      {
        id: newId<'document-line'>(),
        position: 1,
        designation: 'Arbeitszeit',
        quantityMilli: 1500,
        unit: 'hour',
        articleId: labour,
      },
      {
        id: newId<'document-line'>(),
        position: 2,
        designation: 'LS-Schalter B16',
        quantityMilli: 2000,
        unit: 'piece',
        articleId: breaker,
      },
      {
        id: newId<'document-line'>(),
        position: 3,
        designation: 'NYM-J 3 × 1,5',
        quantityMilli: 25_000,
        unit: 'metre',
        articleId: cable,
      },
    ]
    const { receipts } = await push(app, technician, [
      created('documents', id, {
        customerId,
        jobId,
        kind: 'time_and_material_report',
        documentDate: '2026-10-31',
        introText,
        storeId: later ? null : storeId,
      }),
      ...(later ? [changed('documents', id, { storeId: { from: null, to: storeId } })] : []),
      ...lines.map((line) =>
        created('document_lines', line.id, {
          documentId: id,
          kind: 'item',
          position: line.position,
          designation: line.designation,
          quantityMilli: line.quantityMilli,
          unit: line.unit,
          unitPriceCents: 0,
          articleId: line.articleId,
        }),
      ),
    ])

    expect(receipts.every((receipt) => receipt.outcome === 'applied')).toBe(true)

    const fingerprint = signedContentFingerprint({
      introText,
      lines: lines.map(({ articleId: _, ...line }) => ({
        ...line,
        kind: 'item' as const,
        description: null,
        unit: line.unit as 'hour' | 'piece' | 'metre',
      })),
    })
    const signed = await push(app, technician, [
      created('document_signatures', newId<'document-signature'>(), {
        documentId: id,
        signerName: 'Erika Berg',
        signedAt: '2026-10-31T12:32:00.000Z',
        deviceInfo: 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile',
        path: scribble,
        contentFingerprint: fingerprint,
      }),
    ])

    expect(signed.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])

    return { id, lines }
  }

  async function bookedFor(documentId: string) {
    const { rows } = await admin.query<{
      article_id: string
      quantity_milli: number
      job_id: string
      store_id: string
    }>(
      `select m.article_id, m.quantity_milli, m.job_id, m.store_id from stock_movements m
         join document_lines l on l.id = m.document_line_id where l.document_id = $1 and m.kind = 'withdrawal'
        order by m.quantity_milli`,
      [documentId],
    )

    return rows
  }

  it('takes its material out of the store it names, once, for its job, and not its hours', async () => {
    const before = await stockOf(van)
    const signed = await report(van)

    expect(await bookedFor(signed.id)).toEqual([
      { article_id: breaker, quantity_milli: 2000, job_id: jobId, store_id: van },
      { article_id: cable, quantity_milli: 25_000, job_id: jobId, store_id: van },
    ])

    // The job shows it as its goods out, with the store and the report.
    const out = (await get(`/jobs/${jobId}/withdrawals`)) as unknown as {
      number: string
      quantity_milli: number
      store_name: string
      document_id: string
    }[]

    expect(
      out.map((row) => [row.number, row.quantity_milli, row.store_name, row.document_id]),
    ).toEqual(
      [
        ['1042', 25_000, 'Transporter HD-OG 412', signed.id],
        ['2101', 2000, 'Transporter HD-OG 412', signed.id],
      ].sort((left, right) => (String(left[0]) < String(right[0]) ? -1 : 1)),
    )

    const after = await stockOf(van)

    expect(after['2101']?.levelMilli).toBe((before['2101']?.levelMilli ?? 0) - 2000)
    expect(after['1042']?.levelMilli).toBe((before['1042']?.levelMilli ?? 0) - 25_000)

    // A receipt at the job is no goods out, and another job shows nothing of it.
    await admin.query(
      `insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, job_id)
         values ($1, $2, $3, 'receipt', 1000, $4)`,
      [north.id, van, breaker, jobId],
    )

    const other = (
      await send('post', '/jobs', { customerId, kind: 'service', designation: 'Zählerschrank' })
    ).id

    expect(await get(`/jobs/${jobId}/withdrawals`)).toHaveLength(2)
    expect(await get(`/jobs/${other}/withdrawals`)).toEqual([])
  })

  it('takes it out of the store chosen on the device once the report was begun', async () => {
    const signed = await report(van, true)

    expect((await bookedFor(signed.id)).map((row) => row.store_id)).toEqual([van, van])
  })

  it('takes nothing out where it names no store', async () => {
    const signed = await report(null)

    expect(await bookedFor(signed.id)).toEqual([])
  })

  it('may take more than lies there: the stock falls below zero, and the list says so', async () => {
    await report(van)
    await report(van)

    const held = await stockOf(van)

    expect(held['1042']?.levelMilli).toBeLessThan(0)

    const listed = (await get('/stores')) as unknown as { name: string; belowZero: number }[]

    expect(listed.find((row) => row.name === 'Transporter HD-OG 412')?.belowZero).toBe(
      Object.values(held).filter((row) => row.levelMilli < 0).length,
    )
  })
})

describe('a delivery note (#299)', () => {
  interface Line {
    readonly id: string
    readonly position: number
    readonly kind: 'item' | 'title'
    readonly designation: string
    readonly description: string | null
    readonly quantityMilli: number
    readonly unit: 'piece' | 'metre'
    readonly unitPriceCents: number
    readonly articleId: string | null
  }

  const linesOf = async (documentId: string) =>
    (await get(`/documents/${documentId}/lines`)) as unknown as Line[]

  /** An issued order confirmation of the job: three breakers and 20 m of cable at its prices. */
  async function confirmed() {
    const confirmation = await send('post', '/documents', {
      customerId,
      jobId,
      kind: 'order_confirmation',
      documentDate: '2026-10-31',
    })

    await send('post', `/documents/${confirmation.id}/lines`, {
      designation: 'LS-Schalter B16',
      quantityMilli: 3000,
      unit: 'piece',
      unitPriceCents: 890,
      articleId: breaker,
    })
    await send('post', `/documents/${confirmation.id}/lines`, {
      designation: 'NYM-J 3 × 1,5',
      quantityMilli: 20_000,
      unit: 'metre',
      unitPriceCents: 150,
      articleId: cable,
    })
    await send('post', `/documents/${confirmation.id}/issue`, {})

    return confirmation.id
  }

  /** The delivery note out of a fresh confirmation, delivered from the store. */
  async function deliveryNote() {
    const confirmation = await confirmed()
    const note = await send('post', `/documents/${confirmation}/successors`, {
      kind: 'delivery_note',
    })

    await send('patch', `/documents/${note.id}`, { storeId: store }, office, 200)

    return { confirmation, note: note.id }
  }

  async function withdrawalsOf(documentId: string) {
    const { rows } = await admin.query<{
      article_id: string
      quantity_milli: number
      store_id: string
    }>(
      `select m.article_id, m.quantity_milli, m.store_id from stock_movements m
         join document_lines l on l.id = m.document_line_id
        where l.document_id = $1 and m.kind = 'withdrawal' order by m.quantity_milli`,
      [documentId],
    )

    return rows
  }

  async function signOnDevice(documentId: string) {
    const lines = await linesOf(documentId)

    return push(app, technician, [
      created('document_signatures', newId<'document-signature'>(), {
        documentId,
        signerName: 'Thomas Brenner',
        signedAt: '2026-10-31T10:14:00.000Z',
        deviceInfo: 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile',
        path: scribble,
        contentFingerprint: signedContentFingerprint({
          introText: null,
          lines: lines.map((line) => ({
            id: line.id,
            position: line.position,
            kind: line.kind,
            designation: line.designation,
            description: line.description,
            quantityMilli: line.quantityMilli,
            unit: line.unit,
          })),
        }),
      }),
    ])
  }

  it('is made once out of an order confirmation, with its lines and their prices', async () => {
    const { confirmation, note } = await deliveryNote()

    expect(
      (await linesOf(note)).map((line) => [
        line.articleId,
        line.quantityMilli,
        line.unitPriceCents,
      ]),
    ).toEqual([
      [breaker, 3000, 890],
      [cable, 20_000, 150],
    ])
    expect(
      (
        await send(
          'post',
          `/documents/${confirmation}/successors`,
          { kind: 'delivery_note' },
          office,
          409,
        )
      ).message,
    ).toContain(
      'schon ein Lieferschein entstanden, noch als Entwurf. Die Kette geht bei ihm weiter',
    )
  })

  it('takes its material out of its store when its recipient signs it, and issuing books it no second time', async () => {
    const { note } = await deliveryNote()
    const signed = await signOnDevice(note)

    expect(signed.receipts.map((receipt) => receipt.outcome)).toEqual(['applied'])
    expect(
      (await admin.query<{ status: string }>('select status from documents where id = $1', [note]))
        .rows[0]?.status,
    ).toBe('signed')

    const booked = [
      { article_id: breaker, quantity_milli: 3000, store_id: store },
      { article_id: cable, quantity_milli: 20_000, store_id: store },
    ]

    expect(await withdrawalsOf(note)).toEqual(booked)

    const issued = await send('post', `/documents/${note}/issue`, {})

    expect(issued['number']).toMatch(/^LS-2026-/)
    expect(await withdrawalsOf(note)).toEqual(booked)
  })

  it('takes it out when the office issues it without a signature, once', async () => {
    const { note } = await deliveryNote()

    expect(await withdrawalsOf(note)).toEqual([])

    await send('post', `/documents/${note}/issue`, {})

    expect(await withdrawalsOf(note)).toEqual([
      { article_id: breaker, quantity_milli: 3000, store_id: store },
      { article_id: cable, quantity_milli: 20_000, store_id: store },
    ])
  })

  it('gives the invoice out of it the prices of the confirmation, not those of the articles', async () => {
    await send('post', `/articles/${breaker}/prices`, {
      unitPriceCents: 1290,
      validFrom: '2026-01-01',
    })

    const { note } = await deliveryNote()

    await send('post', `/documents/${note}/issue`, {})

    const invoice = await send('post', `/documents/${note}/successors`, { kind: 'final_invoice' })

    expect((await linesOf(invoice.id)).map((line) => line.unitPriceCents)).toEqual([890, 150])
  })

  it('names a store, and no other kind but a report does', async () => {
    const confirmation = await send('post', '/documents', {
      customerId,
      jobId,
      kind: 'order_confirmation',
      documentDate: '2026-10-31',
    })

    await send('patch', `/documents/${confirmation.id}`, { storeId: store }, office, 400)
  })
})

describe('a device', () => {
  it('holds the stores, the stock of the vehicles and their articles, and nothing of a store in a building', async () => {
    const pulled = (
      await http().get('/sync?since=0').set('x-test-identity', technician).expect(200)
    ).body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
    const rowsOf = (entity: string) =>
      pulled.changes.find((change) => change.entity === entity)?.rows ?? []

    expect(
      rowsOf('stores')
        .map((row) => row['name'])
        .sort(),
    ).toEqual(['Lager Edingen', 'Transporter HD-OG 412'])
    expect(new Set(rowsOf('stock_movements').map((row) => row['storeId']))).toEqual(new Set([van]))
    expect(new Set(rowsOf('store_articles').map((row) => row['storeId']))).toEqual(new Set([van]))

    // An article that lies only in the vehicle, never frequent and in no
    // position, is on the device as well: the stock of a vehicle is.
    const box = await article('5001', 'Abzweigdose AP, IP65', 'piece')

    await send('post', `/stores/${store}/receipts`, { articleId: box, quantityMilli: 10_000 })

    expect(
      (await database.forTenant({ tenantId: north.id }, (tx) => articlesOnDevices(tx))).articleIds,
    ).not.toContain(box)

    await send('post', `/stores/${store}/transfers`, {
      articleId: box,
      quantityMilli: 4000,
      toStoreId: van,
    })

    expect(
      (await database.forTenant({ tenantId: north.id }, (tx) => articlesOnDevices(tx))).articleIds,
    ).toContain(box)
  })

  it('writes no store, no place in one and no booking: the office books at its routes, the server at a signature', async () => {
    const answer = await push(app, office, [
      created('stores', newId<'store'>(), { name: 'Vom Gerät' }),
      created('store_articles', newId<'store-article'>(), { storeId: van, articleId: cable }),
      created('stock_movements', newId<'stock-movement'>(), {
        storeId: van,
        articleId: cable,
        kind: 'receipt',
        quantityMilli: 1000,
      }),
    ])

    expect(answer.receipts.map((receipt) => [receipt.outcome, receipt.reason])).toEqual([
      ['conflict', 'online_only'],
      ['conflict', 'online_only'],
      ['conflict', 'online_only'],
    ])
  })
})
