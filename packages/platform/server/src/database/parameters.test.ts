import type { IsoDate, TenantId } from '@opengewerk/platform-domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type ProbeFoundation, probeFoundation } from '../authentication/probe-application.js'
import { Database, type TenantTransaction } from './database.js'
import { newId } from './identifier.js'
import { ParameterError, tenantParameterStore } from './parameters.js'
import { probeParameters } from './probe-schema.js'

/**
 * What a tenant sets for itself, with the day it applies from (ADR 0010).
 *
 * The settings here are nobody's: how many nights a note is kept, and whether
 * guests are let in. The store has to work with keys and units it has never
 * seen, because every application brings its own.
 */

const north = { id: newId<'tenant'>(), name: 'Mandant Nord' }
const south = { id: newId<'tenant'>(), name: 'Mandant Süd' }

const store = tenantParameterStore(probeParameters, {
  names: {
    'notes.kept_days': 'die Aufbewahrung der Notizen',
    'guests.admitted': 'den Einlass von Gästen',
  },
  units: { 'notes.kept_days': 'nights', 'guests.admitted': 'yes_no' },
  problemOf: (key, value) => {
    if (key === 'guests.admitted') {
      return value === 0 || value === 1 ? null : 'Gäste sind zugelassen oder nicht: 1 oder 0.'
    }

    return value >= 1 ? null : 'Eine Notiz bleibt mindestens eine Nacht.'
  },
})

const day = (iso: string) => iso as IsoDate

let foundation: ProbeFoundation
let admin: Pool
let database: Database

function inTenant<Result>(
  tenantId: TenantId,
  work: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return database.forTenant({ tenantId, reason: 'probe.write' }, work)
}

beforeAll(async () => {
  foundation = await probeFoundation()
  admin = await foundation.kit.connect()
  await foundation.empty(admin)
  await foundation.tenants(admin, [north, south])

  database = Database.connect(foundation.kit.applicationDatabaseUrl())
})

beforeEach(async () => {
  await admin.query('delete from tenant_parameters')
})

afterAll(async () => {
  await database.close()
  await foundation.kit.resetSchema(admin)
  await admin.end()
  foundation.remove()
})

describe('a setting of a tenant', () => {
  it('applies from its day on and not before, in the unit the application names', async () => {
    await inTenant(north.id, (tx) =>
      store.setParameter(tx, north.id, {
        key: 'notes.kept_days',
        from: day('2037-03-01'),
        value: 30,
        note: 'Beschluss vom Februar',
      }),
    )

    expect(
      await inTenant(north.id, (tx) => store.parameterAt(tx, 'notes.kept_days', day('2037-02-28'))),
    ).toBeNull()

    for (const on of ['2037-03-01', '2040-12-31']) {
      expect(
        await inTenant(north.id, (tx) => store.parameterAt(tx, 'notes.kept_days', day(on))),
      ).toMatchObject({
        tenantId: north.id,
        key: 'notes.kept_days',
        validFrom: '2037-03-01',
        validUntil: null,
        unit: 'nights',
        value: 30,
        note: 'Beschluss vom Februar',
      })
    }

    // Another setting of the same tenant has nothing to do with it.
    expect(
      await inTenant(north.id, (tx) => store.parameterAt(tx, 'guests.admitted', day('2037-03-01'))),
    ).toBeNull()
  })

  /**
   * Nothing is edited. Whatever was judged by the old value on a day in its
   * period is still judged by it after the new one began.
   */
  it('is superseded and not edited: the period before ends the day before the next begins', async () => {
    await inTenant(north.id, async (tx) => {
      await store.setParameter(tx, north.id, {
        key: 'notes.kept_days',
        from: day('2037-03-01'),
        value: 30,
      })
      await store.setParameter(tx, north.id, {
        key: 'notes.kept_days',
        from: day('2038-01-01'),
        value: 90,
      })
    })

    const at = (on: string) =>
      inTenant(north.id, (tx) => store.parameterAt(tx, 'notes.kept_days', day(on)))

    expect(await at('2037-12-31')).toMatchObject({ value: 30, validUntil: '2037-12-31' })
    expect(await at('2038-01-01')).toMatchObject({ value: 90, validUntil: null })
    expect(await at('2037-06-15')).toMatchObject({ value: 30 })
  })

  /**
   * Forward only. A period slipped in behind an existing one would leave two
   * of them covering the same day. The refusal names the setting the way a
   * person reads it, in the words the application handed in, and never by its
   * key.
   */
  it('begins only after the last one, and says so in the words of the application', async () => {
    await inTenant(north.id, (tx) =>
      store.setParameter(tx, north.id, {
        key: 'notes.kept_days',
        from: day('2037-03-01'),
        value: 30,
      }),
    )

    for (const from of ['2037-03-01', '2036-01-01']) {
      const refused = inTenant(north.id, (tx) =>
        store.setParameter(tx, north.id, { key: 'notes.kept_days', from: day(from), value: 7 }),
      )

      await expect(refused).rejects.toBeInstanceOf(ParameterError)
      await expect(refused).rejects.toThrow(
        'Für die Aufbewahrung der Notizen gilt bereits ein Wert ab 01.03.2037. ' +
          'Ein neuer Wert kann nur später beginnen.',
      )
    }

    // And nothing came of the refused ones.
    expect(await inTenant(north.id, (tx) => store.parameterHistory(tx))).toHaveLength(1)
  })

  /**
   * What a value has to be, only the application knows, and it is asked here:
   * whichever way a value comes in, it passes the store. That a value is a
   * whole number the store asks itself.
   */
  it('takes a value only as the application checks it, and refuses in its words', async () => {
    const set = (key: 'notes.kept_days' | 'guests.admitted', value: number) =>
      inTenant(north.id, (tx) =>
        store.setParameter(tx, north.id, { key, from: day('2037-03-01'), value }),
      )

    for (const [key, value, sentence] of [
      ['guests.admitted', 2, 'Gäste sind zugelassen oder nicht: 1 oder 0.'],
      ['guests.admitted', -1, 'Gäste sind zugelassen oder nicht: 1 oder 0.'],
      ['notes.kept_days', 0, 'Eine Notiz bleibt mindestens eine Nacht.'],
      ['notes.kept_days', 1.5, 'Der Wert einer Einstellung ist eine ganze Zahl.'],
      ['notes.kept_days', 3_000_000_000, 'Der Wert einer Einstellung ist eine ganze Zahl.'],
      ['notes.kept_days', Number.NaN, 'Der Wert einer Einstellung ist eine ganze Zahl.'],
    ] as const) {
      const refused = set(key, value)

      await expect(refused).rejects.toBeInstanceOf(ParameterError)
      await expect(refused).rejects.toThrow(sentence)
    }

    // Nothing came of the refused ones, and what the application takes is kept.
    expect(await inTenant(north.id, (tx) => store.parameterHistory(tx))).toHaveLength(0)

    await set('guests.admitted', 1)
    await set('notes.kept_days', 1)

    expect(
      (await inTenant(north.id, (tx) => store.parameterHistory(tx))).map((row) => row.value),
    ).toEqual([1, 1])
  })

  it('comes with its history, setting by setting, the newest period first', async () => {
    await inTenant(north.id, async (tx) => {
      await store.setParameter(tx, north.id, {
        key: 'notes.kept_days',
        from: day('2037-03-01'),
        value: 30,
      })
      await store.setParameter(tx, north.id, {
        key: 'guests.admitted',
        from: day('2037-04-01'),
        value: 1,
      })
      await store.setParameter(tx, north.id, {
        key: 'notes.kept_days',
        from: day('2038-01-01'),
        value: 90,
      })
    })

    const history = await inTenant(north.id, (tx) => store.parameterHistory(tx))

    expect(history.map((row) => [row.key, row.validFrom, row.value, row.unit])).toEqual([
      ['notes.kept_days', '2038-01-01', 90, 'nights'],
      ['notes.kept_days', '2037-03-01', 30, 'nights'],
      ['guests.admitted', '2037-04-01', 1, 'yes_no'],
    ])
  })
})

describe('the table behind it', () => {
  /**
   * The store does not name the tenant when it reads: row level security is
   * what keeps the settings of one tenant from another. Two tenants with the
   * same setting each see their own, and a period of one does not close the
   * period of the other.
   */
  it('keeps the settings of a tenant inside it', async () => {
    await inTenant(north.id, (tx) =>
      store.setParameter(tx, north.id, {
        key: 'notes.kept_days',
        from: day('2037-03-01'),
        value: 30,
      }),
    )
    await inTenant(south.id, (tx) =>
      store.setParameter(tx, south.id, {
        key: 'notes.kept_days',
        from: day('2037-06-01'),
        value: 5,
      }),
    )

    expect(
      await inTenant(north.id, (tx) => store.parameterAt(tx, 'notes.kept_days', day('2037-07-01'))),
    ).toMatchObject({ tenantId: north.id, value: 30, validUntil: null })
    expect(
      await inTenant(south.id, (tx) => store.parameterAt(tx, 'notes.kept_days', day('2037-07-01'))),
    ).toMatchObject({ tenantId: south.id, value: 5 })
    expect(
      (await inTenant(south.id, (tx) => store.parameterHistory(tx))).map((row) => row.tenantId),
    ).toEqual([south.id])

    // A setting written for the tenant next door is refused by the database.
    await expect(
      inTenant(north.id, (tx) =>
        store.setParameter(tx, south.id, {
          key: 'guests.admitted',
          from: day('2037-01-01'),
          value: 1,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })

  it('is watched by the log, and nothing in it can be removed by the application', async () => {
    const written = await inTenant(north.id, (tx) =>
      store.setParameter(tx, north.id, {
        key: 'guests.admitted',
        from: day('2037-01-01'),
        value: 1,
      }),
    )

    // Of this one row: the log keeps what the tests before this one wrote.
    const { rows: logged } = await admin.query<{ field: string; new_value: string | null }>(
      `select field, new_value from audit_entries
        where tenant_id = $1 and table_name = 'tenant_parameters' and record_id = $2
          and operation = 'insert' and field in ('key', 'value')
        order by field`,
      [north.id, written.id],
    )

    expect(logged).toEqual([
      { field: 'key', new_value: 'guests.admitted' },
      { field: 'value', new_value: '1' },
    ])

    await expect(
      database.forTenant({ tenantId: north.id }, (tx) => tx.delete(probeParameters)),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })
})
