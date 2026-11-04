import { personalDataCatalogue, soundsPersonal } from '@opengewerk/domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, resetToMigrated } from './test-database.js'

/**
 * The catalogue of personal data (#317) against the database as it is
 * migrated: every table placed, every column it names there, and every column
 * whose name says it may name somebody placed as personal or not.
 */

let admin: Pool
let columns = new Map<string, Set<string>>()

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  const found = await admin.query<{ table_name: string; column_name: string }>(
    `select c.table_name, c.column_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
  )

  columns = new Map()

  for (const row of found.rows) {
    const known = columns.get(row.table_name) ?? new Set<string>()

    known.add(row.column_name)
    columns.set(row.table_name, known)
  }
})

afterAll(async () => {
  await admin.end()
})

describe('the catalogue of personal data', () => {
  it('places every table of the database, and none that is not there', () => {
    const tables = [...columns.keys()].sort()
    const placed = Object.keys(personalDataCatalogue).sort()

    expect({ missing: tables.filter((name) => !placed.includes(name)) }).toEqual({ missing: [] })
    expect({ gone: placed.filter((name) => !tables.includes(name)) }).toEqual({ gone: [] })
  })

  it('names only columns its tables have', () => {
    const unknown = Object.entries(personalDataCatalogue).flatMap(([table, entry]) =>
      [...entry.columns, ...(entry.notPersonal ?? [])]
        .filter((column) => !columns.get(table)?.has(column))
        .map((column) => `${table}.${column}`),
    )

    expect(unknown).toEqual([])
  })

  it('says whose data a table holds exactly where it names columns that hold it', () => {
    const odd = Object.entries(personalDataCatalogue)
      .filter(([, entry]) => entry.about.length > 0 !== entry.columns.length > 0)
      .map(([table]) => table)

    expect(odd).toEqual([])
  })

  it('places every column whose name says it may name somebody', () => {
    const unplaced = [...columns.entries()].flatMap(([table, names]) => {
      const entry = personalDataCatalogue[table]
      const placed = new Set([...(entry?.columns ?? []), ...(entry?.notPersonal ?? [])])

      return [...names]
        .filter(
          (column) => soundsPersonal(column) && column !== 'updated_by' && !placed.has(column),
        )
        .map((column) => `${table}.${column}`)
    })

    expect(unplaced).toEqual([])
  })

  it('keeps the protocol of the deletion concept free of everything but who deleted', () => {
    expect(personalDataCatalogue['erasures']).toEqual({
      about: ['person'],
      columns: ['created_by'],
    })
  })
})
