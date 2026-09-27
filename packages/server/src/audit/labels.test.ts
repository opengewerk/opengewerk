import {
  auditFieldName,
  auditParts,
  auditPersonFields,
  auditReferences,
  auditTables,
  auditTitleFields,
} from '@opengewerk/domain'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyMigrations, connect, resetSchema } from '../database/test-database.js'

/**
 * The words of the change log against the database (#285). The owner reads
 * "Kunde, Straße" and never `customers.street`: every table the audit trigger
 * watches has a name, every column of it has one, and the rules that walk the
 * log only name columns that exist. A new column without a German name fails
 * here instead of showing up as a column name in front of the owner.
 */

let admin: Pool
/** Every audited table with its columns, read from the catalogue. */
const audited = new Map<string, string[]>()

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()

  const { rows } = await admin.query<{ table_name: string; column_name: string }>(
    `select c.table_name, c.column_name
       from information_schema.columns c
      where c.table_schema = 'public'
        and exists (select 1 from information_schema.triggers t
                     where t.event_object_table = c.table_name
                       and t.trigger_name = 'audit_changes')
      order by c.table_name, c.ordinal_position`,
  )

  for (const row of rows) {
    audited.set(row.table_name, [...(audited.get(row.table_name) ?? []), row.column_name])
  }
})

afterAll(async () => {
  await admin.end()
})

describe('the words of the change log', () => {
  it('names every table the trigger watches, and no other', () => {
    expect(audited.size).toBeGreaterThan(40)
    expect([...audited.keys()].sort()).toEqual(Object.keys(auditTables).sort())
  })

  it('names every column of them', () => {
    const unnamed = [...audited].flatMap(([table, columns]) =>
      columns
        .filter((column) => auditFieldName(table, column) === null)
        .map((column) => `${table}.${column}`),
    )

    expect(unnamed).toEqual([])
  })

  it('walks parts, names and references only through columns that exist', () => {
    const missing: string[] = []
    const has = (table: string, column: string) => audited.get(table)?.includes(column) ?? false

    for (const [table, parts] of Object.entries(auditParts)) {
      if (!audited.has(table)) {
        missing.push(`parent ${table}`)
      }

      for (const part of parts) {
        if (!has(part.table, part.column)) {
          missing.push(`part ${part.table}.${part.column}`)
        }
      }
    }

    for (const table of audited.keys()) {
      const named = auditTitleFields(table).filter((field) => has(table, field))

      if (named.length === 0) {
        missing.push(`title of ${table}`)
      }
    }

    for (const [column, target] of Object.entries(auditReferences)) {
      if (
        !audited.has(target) ||
        ![...audited.values()].some((columns) => columns.includes(column))
      ) {
        missing.push(`reference ${column} to ${target}`)
      }
    }

    for (const column of auditPersonFields) {
      if (![...audited.values()].some((columns) => columns.includes(column))) {
        missing.push(`person field ${column}`)
      }
    }

    expect(missing).toEqual([])
  })
})
