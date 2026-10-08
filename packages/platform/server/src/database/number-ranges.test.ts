import type { TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from './database.js'
import { newId } from './identifier.js'
import { NumberRangeRefused, numberRangeStore } from './number-ranges.js'
import { probeNumberRanges } from './probe-schema.js'

/**
 * Numbers that run without holes, for sequences the foundation has never
 * heard of (ADR 0010).
 *
 * The sequences here are nobody's: the parcels a tenant takes in and the
 * visits it receives. The numbering has to hold under the two conditions that
 * break it in practice, several people drawing at the same moment and a
 * transaction that fails after it drew, and it has to do so for whatever an
 * application numbers.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

/**
 * The year where the tenants of the probe application are: on an island
 * fourteen hours ahead of UTC. Deliberately neither the clock of the process
 * nor the time zone of a real application, so that a number with the right
 * year in it can only have asked this function.
 */
const yearOnTheIsland = (moment: Date) =>
  Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Pacific/Kiritimati', year: 'numeric' }).format(
      moment,
    ),
  )

const store = numberRangeStore(probeNumberRanges, {
  keys: ['parcel', 'visit'],
  defaultPatterns: { parcel: 'PK-{year}-{number:5}', visit: 'B{number}' },
  yearOf: yearOnTheIsland,
})

/** Noon in UTC on the last day of 2037, which is the second of the new year's hours on the island. */
const newYearOnTheIsland = new Date('2037-12-31T12:00:00Z')
/** A day in the middle of 2037, wherever one is. */
const midsummer = new Date('2037-06-15T12:00:00Z')

let foundation: ProbeFoundation
let admin: Pool
let database: Database

function inTenant<Result>(
  tenantId: TenantId,
  work: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return database.forTenant({ tenantId, reason: 'probe.write' }, work)
}

const draw = (tenantId: TenantId, key: 'parcel' | 'visit', at: Date = midsummer) =>
  inTenant(tenantId, (tx) => store.assignNumber(tx, tenantId, key, at))

const rangesOf = (tenantId: TenantId, now: Date = midsummer) =>
  inTenant(tenantId, (tx) => store.numberRangesOf(tx, tenantId, now))

/**
 * The same transaction, with every `update` held back until the gate opens:
 * what is chained onto the statement is replayed on the real one then. The
 * moment between reading and writing is the one a test cannot reach from
 * outside, and it is the one a lock is for.
 */
function holdingItsWrites(
  tx: TenantTransaction,
  gate: Promise<void>,
  aboutToWrite: () => void,
): TenantTransaction {
  type Chained = Record<PropertyKey, (...given: unknown[]) => unknown>

  const later = (statement: () => unknown): unknown =>
    new Proxy(() => undefined, {
      get: (_target, step) =>
        step === 'then'
          ? (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
              aboutToWrite()

              return gate.then(statement).then(resolve, reject)
            }
          : (...given: unknown[]) => later(() => (statement() as Chained)[step]?.(...given)),
    })

  return new Proxy(tx, {
    get(target, property) {
      if (property === 'update') {
        return (table: Parameters<TenantTransaction['update']>[0]) =>
          later(() => target.update(table))
      }

      const value: unknown = Reflect.get(target, property, target)

      return typeof value === 'function'
        ? (value as (...given: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

/** Waits until a session of this database stands at a lock somebody else holds. */
async function untilSomebodyWaits(): Promise<void> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const { rows } = await admin.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    )

    if ((rows[0]?.waiting ?? 0) > 0) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error('Nobody came to wait at the lock')
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty()
  await foundation.tenants(admin, [north, south])

  database = Database.connect(foundation.kit.applicationDatabaseUrl())
})

beforeEach(async () => {
  await admin.query('delete from number_ranges')
})

afterAll(async () => {
  await database.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('numbers drawn at the same moment', () => {
  it('are neither repeated nor skipped', async () => {
    // All at once, each in its own transaction on its own connection. The row
    // lock on the counter is what serialises them; without it this is the
    // test that produces two parcels with the same number.
    const numbers = await Promise.all(Array.from({ length: 20 }, () => draw(north.id, 'parcel')))

    expect(new Set(numbers).size).toBe(20)
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `PK-2037-${String(index + 1).padStart(5, '0')}`),
    )
  })

  it('leave no hole behind when a transaction fails', async () => {
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00001')

    await expect(
      inTenant(north.id, async (tx) => {
        expect(await store.assignNumber(tx, north.id, 'parcel', midsummer)).toBe('PK-2037-00002')

        throw new Error('Something fails after the number was drawn')
      }),
    ).rejects.toThrow('Something fails after the number was drawn')

    // The counter went back with the rollback. This is the reason it lives in
    // a row and not in a PostgreSQL sequence: a sequence would have kept the
    // value and left a gap nobody can explain.
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00002')
  })

  it('run separately per sequence and per tenant', async () => {
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00001')
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00002')

    // Another sequence of the same tenant starts at one, with its own pattern,
    // and so does the same sequence of the tenant next door.
    expect(await draw(north.id, 'visit')).toBe('B1')
    expect(await draw(south.id, 'parcel')).toBe('PK-2037-00001')

    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00003')
  })
})

describe('numbers drawn in one step', () => {
  const drawMany = (tenantId: TenantId, count: number) =>
    inTenant(tenantId, (tx) => store.assignNumbers(tx, tenantId, 'parcel', midsummer, count))

  /** How often the log says the counter of the parcels of a tenant moved. */
  const counterChanges = async (tenantId: TenantId) => {
    const { rows } = await admin.query<{ changes: number }>(
      `select count(*)::int as changes from audit_entries
        where tenant_id = $1 and table_name = 'number_ranges'
          and operation = 'update' and field = 'next_value'`,
      [tenantId],
    )

    return rows[0]?.changes ?? 0
  }

  it('follow the last number in their order, and the next number follows them', async () => {
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00001')
    expect(await drawMany(north.id, 3)).toEqual(['PK-2037-00002', 'PK-2037-00003', 'PK-2037-00004'])
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00005')
  })

  it('are one change of the counter in the log, however many they are', async () => {
    await draw(north.id, 'parcel')

    const before = await counterChanges(north.id)

    expect(await drawMany(north.id, 250)).toHaveLength(250)
    expect((await counterChanges(north.id)) - before).toBe(1)

    // Drawn one by one, three numbers are three changes: that is what the step saves.
    await draw(north.id, 'parcel')
    await draw(north.id, 'parcel')
    await draw(north.id, 'parcel')
    expect((await counterChanges(north.id)) - before).toBe(4)
  })

  it('go back together with the transaction that drew them', async () => {
    await expect(
      inTenant(north.id, async (tx) => {
        expect(await store.assignNumbers(tx, north.id, 'parcel', midsummer, 3)).toHaveLength(3)

        throw new Error('Something fails after the numbers were drawn')
      }),
    ).rejects.toThrow('Something fails after the numbers were drawn')

    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00001')
  })

  it('are unbroken runs beside numbers drawn at the same moment, and none is given twice', async () => {
    const drawn = await Promise.all([
      drawMany(north.id, 5),
      ...Array.from({ length: 5 }, async () => [await draw(north.id, 'parcel')]),
      drawMany(north.id, 5),
    ])
    const counterOf = (number: string) => Number(number.slice(-5))

    expect(
      drawn
        .flat()
        .map(counterOf)
        .sort((one, other) => one - other),
    ).toEqual(Array.from({ length: 15 }, (_, index) => index + 1))

    for (const run of drawn) {
      const first = counterOf(run[0] ?? '')

      expect(run.map(counterOf)).toEqual(run.map((_, index) => first + index))
    }
  })

  it('are none where none are asked for, and then nothing is written', async () => {
    expect(await drawMany(north.id, 0)).toEqual([])

    const { rows } = await admin.query('select 1 from number_ranges where tenant_id = $1', [
      north.id,
    ])

    expect(rows).toEqual([])
  })

  it('are refused where the count is no whole number, below nought or beyond any list', async () => {
    for (const count of [-1, 1.5, Number.NaN, 100_001]) {
      await expect(drawMany(north.id, count)).rejects.toThrow('at most at once')
    }

    // Nothing was drawn by any of them.
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00001')
  })
})

describe('the year in a number', () => {
  it('is the year the application names for the moment the number is drawn', async () => {
    // Still the old year in UTC and on the clock of any process in Europe,
    // and already the new one where the tenants of this application are.
    expect(newYearOnTheIsland.getUTCFullYear()).toBe(2037)

    expect(await draw(north.id, 'parcel', newYearOnTheIsland)).toBe('PK-2038-00001')
  })
})

describe('the sequences of a tenant', () => {
  it('are all listed in the order of the application, the untouched ones with their default', async () => {
    expect(await rangesOf(north.id, newYearOnTheIsland)).toEqual([
      { key: 'parcel', pattern: 'PK-{year}-{number:5}', nextValue: 1, next: 'PK-2038-00001' },
      { key: 'visit', pattern: 'B{number}', nextValue: 1, next: 'B1' },
    ])

    // Looking is not drawing: no row came of it.
    const { rows } = await admin.query('select 1 from number_ranges')
    expect(rows).toHaveLength(0)
  })

  it('say what the next number will be once some were drawn', async () => {
    await draw(north.id, 'visit')
    await draw(north.id, 'visit')

    expect(await rangesOf(north.id)).toEqual([
      { key: 'parcel', pattern: 'PK-{year}-{number:5}', nextValue: 1, next: 'PK-2037-00001' },
      { key: 'visit', pattern: 'B{number}', nextValue: 3, next: 'B3' },
    ])

    // And the tenant next door has drawn nothing.
    expect((await rangesOf(south.id)).map((range) => range.nextValue)).toEqual([1, 1])
  })
})

describe('a change to a sequence', () => {
  const change = (wanted: { pattern: string; nextValue?: number }, tenantId = north.id) =>
    inTenant(tenantId, (tx) => store.changeNumberRange(tx, tenantId, 'parcel', wanted, midsummer))

  it('applies from the next number and leaves the counter where it is', async () => {
    await draw(north.id, 'parcel')
    await draw(north.id, 'parcel')

    expect(await change({ pattern: 'P/{number:3}' })).toEqual({
      key: 'parcel',
      pattern: 'P/{number:3}',
      nextValue: 3,
      next: 'P/003',
    })

    expect(await draw(north.id, 'parcel')).toBe('P/003')

    // The other sequence and the tenant next door keep theirs.
    expect(await draw(north.id, 'visit')).toBe('B1')
    expect(await draw(south.id, 'parcel')).toBe('PK-2037-00001')
  })

  it('reaches a sequence nothing was drawn from yet', async () => {
    expect(await change({ pattern: 'P{number}', nextValue: 40 })).toMatchObject({
      nextValue: 40,
      next: 'P40',
    })

    expect(await draw(north.id, 'parcel')).toBe('P40')
  })

  it('moves the counter forward, and to where it stands, and never back', async () => {
    // A tenant that comes from another program continues its sequence.
    await change({ pattern: 'PK-{year}-{number:5}', nextValue: 500 })

    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00500')

    // Where it stands is no step back: only the pattern changes then.
    expect(await change({ pattern: 'PK-{number}', nextValue: 501 })).toMatchObject({
      nextValue: 501,
    })

    const back = change({ pattern: 'PK-{number}', nextValue: 500 })

    await expect(back).rejects.toBeInstanceOf(NumberRangeRefused)
    await expect(back).rejects.toThrow(
      'Die nächste Nummer kann nur steigen. Bis 500 ist schon vergeben, ' +
        'darunter käme eine Nummer ein zweites Mal vor.',
    )

    expect(await draw(north.id, 'parcel')).toBe('PK-501')
  })

  it('takes a whole number from one on for the counter', async () => {
    for (const nextValue of [0, -3, 1.5, 1_000_000_000, Number.NaN]) {
      const refused = change({ pattern: 'PK-{number}', nextValue })

      await expect(refused).rejects.toBeInstanceOf(NumberRangeRefused)
      await expect(refused).rejects.toThrow('Die nächste Nummer ist eine ganze Zahl ab 1.')
    }

    // The pattern of a refused change did not arrive either.
    expect((await rangesOf(north.id))[0]).toMatchObject({ pattern: 'PK-{year}-{number:5}' })
  })

  it('is refused with the sentence of the pattern, before anything is written', async () => {
    const refused = change({ pattern: 'PK-{year}' })

    await expect(refused).rejects.toBeInstanceOf(NumberRangeRefused)
    await expect(refused).rejects.toThrow(
      'Es fehlt {number}, die laufende Nummer. Ohne sie wäre jede Nummer gleich.',
    )

    const { rows } = await admin.query('select 1 from number_ranges')
    expect(rows).toHaveLength(0)
  })

  /**
   * A draw that has not committed yet is a draw all the same. A change asking
   * for the counter as it stood before waits for it, and is then judged by
   * the counter as it stands: the number that went out is not handed out a
   * second time.
   */
  it('waits for a number being drawn and is judged by the counter after it', async () => {
    for (let drawn = 0; drawn < 4; drawn++) {
      await draw(north.id, 'parcel')
    }

    let commit!: () => void
    const mayCommit = new Promise<void>((resolve) => {
      commit = resolve
    })
    let fifthIsOut!: () => void
    const fifthDrawn = new Promise<void>((resolve) => {
      fifthIsOut = resolve
    })

    // Somebody draws the fifth number and has not committed yet.
    const drawing = inTenant(north.id, async (tx) => {
      const number = await store.assignNumber(tx, north.id, 'parcel', midsummer)

      fifthIsOut()
      await mayCommit

      return number
    })

    await fifthDrawn

    // Somebody else, at the same moment, asks for the counter to stand at
    // five: where it stood before the draw, as far as anybody can see yet.
    const changing = change({ pattern: 'PK-{number}', nextValue: 5 })
    const outcome = changing.then(
      () => 'changed' as const,
      (error: unknown) => error,
    )

    await untilSomebodyWaits()
    commit()

    expect(await drawing).toBe('PK-2037-00005')

    const refusal = await outcome

    expect(refusal).toBeInstanceOf(NumberRangeRefused)
    expect((refusal as Error).message).toBe(
      'Die nächste Nummer kann nur steigen. Bis 5 ist schon vergeben, ' +
        'darunter käme eine Nummer ein zweites Mal vor.',
    )

    // And the fifth number is not handed out a second time.
    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00006')
  })

  /**
   * The other way round: the change came first. It reads the counter and then
   * writes it, and between the two somebody may draw. The change therefore
   * takes the lock before it reads, and a number drawn in that moment waits
   * for it. Reading first and locking with the write would let the draw
   * through, and the change would then put the counter back onto the number
   * that just went out: the next one drawn would carry it a second time.
   */
  it('holds the counter from reading it to writing it, so that a number drawn meanwhile waits', async () => {
    for (let drawn = 0; drawn < 4; drawn++) {
      await draw(north.id, 'parcel')
    }

    let write!: () => void
    const mayWrite = new Promise<void>((resolve) => {
      write = resolve
    })
    let hasRead!: () => void
    const counterRead = new Promise<void>((resolve) => {
      hasRead = resolve
    })

    // Somebody sets a new pattern and leaves the counter where it stands, at
    // five. The change has read the counter and is about to write.
    const changing = inTenant(north.id, (tx) =>
      store.changeNumberRange(
        holdingItsWrites(tx, mayWrite, hasRead),
        north.id,
        'parcel',
        { pattern: 'PK-{number}', nextValue: 5 },
        midsummer,
      ),
    )

    await counterRead

    // Somebody else draws in that moment. Either the draw waits for the
    // change, which is what the lock is for, or it went through.
    const drawing = draw(north.id, 'parcel')

    await Promise.race([drawing, untilSomebodyWaits()])
    write()

    expect(await changing).toMatchObject({ pattern: 'PK-{number}', nextValue: 5 })

    // The draw came after the change in every respect: its pattern, and the
    // counter it left. No number went out twice.
    expect([await drawing, await draw(north.id, 'parcel')]).toEqual(['PK-5', 'PK-6'])
  })
})

describe('the store', () => {
  it('refuses a default pattern that is no pattern when the application starts', () => {
    expect(() =>
      numberRangeStore(probeNumberRanges, {
        keys: ['parcel', 'visit'],
        defaultPatterns: { parcel: 'PK-{year}', visit: 'B{number}' },
        yearOf: yearOnTheIsland,
      }),
    ).toThrow(
      'The default pattern of the number range parcel is not one: ' +
        'Es fehlt {number}, die laufende Nummer. Ohne sie wäre jede Nummer gleich.',
    )
  })
})

describe('the table behind it', () => {
  it('keeps the sequences of a tenant inside it', async () => {
    await draw(south.id, 'parcel')

    // A number drawn for the tenant next door is refused by the database,
    // from a sequence that tenant has as from one it has not yet: the row a
    // draw makes sure of would be a row of that tenant, and the policy looks
    // at it before anything else does.
    for (const key of ['visit', 'parcel'] as const) {
      await expect(
        inTenant(north.id, (tx) => store.assignNumber(tx, south.id, key, midsummer)),
      ).rejects.toMatchObject({ cause: { code: '42501' } })
    }

    // The same for a change, which never gets as far as the counter.
    await expect(
      inTenant(north.id, (tx) =>
        store.changeNumberRange(tx, south.id, 'parcel', { pattern: 'X{number}', nextValue: 90 }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })

    // And asking for the sequences of the tenant next door shows none of its
    // counters: the defaults, as for a tenant that never drew.
    expect(
      (await inTenant(north.id, (tx) => store.numberRangesOf(tx, south.id, midsummer))).map(
        (range) => range.nextValue,
      ),
    ).toEqual([1, 1])

    expect(await rangesOf(south.id)).toEqual([
      { key: 'parcel', pattern: 'PK-{year}-{number:5}', nextValue: 2, next: 'PK-2037-00002' },
      { key: 'visit', pattern: 'B{number}', nextValue: 1, next: 'B1' },
    ])
  })

  it('is watched by the log, which keeps the pattern a number was once built from', async () => {
    await draw(north.id, 'parcel')
    await inTenant(north.id, (tx) =>
      store.changeNumberRange(tx, north.id, 'parcel', { pattern: 'P/{number:3}' }, midsummer),
    )

    const { rows: range } = await admin.query<{ id: string }>(
      `select id from number_ranges where tenant_id = $1 and key = 'parcel'`,
      [north.id],
    )
    const { rows: logged } = await admin.query<{
      old_value: string | null
      new_value: string | null
    }>(
      `select old_value, new_value from audit_entries
        where tenant_id = $1 and table_name = 'number_ranges' and record_id = $2
          and operation = 'update' and field = 'pattern'`,
      [north.id, range[0]?.id],
    )

    expect(logged).toEqual([{ old_value: 'PK-{year}-{number:5}', new_value: 'P/{number:3}' }])
  })

  /**
   * A sequence that is gone begins again at one, and the next number drawn
   * would be one a record already carries. Nothing in the store removes a
   * range, and the database does not let the application do it either.
   */
  it('lets the application remove no sequence', async () => {
    await draw(north.id, 'parcel')

    await expect(
      database.forTenant({ tenantId: north.id }, (tx) => tx.delete(probeNumberRanges)),
    ).rejects.toMatchObject({ cause: { code: '42501' } })

    expect(await draw(north.id, 'parcel')).toBe('PK-2037-00002')
  })
})
