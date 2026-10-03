import {
  auditLanguage,
  type AuditVocabulary,
  foundationAuditReasons,
  foundationAuditTables,
} from '@opengewerk/platform-domain'
import type { Pool } from 'pg'

/**
 * Where the vocabulary of an application does not fit its database, as one
 * line per finding; empty when it fits (ADR 0010).
 *
 * A person reads "Zugang, Rollen" and never `memberships.roles`: every table
 * a trigger of the log watches has a name, every column of it has one, and
 * the rules that walk the log only name tables and columns that exist. The
 * catalogue is the list, so a new column without a name fails here, in the
 * test of the application that added it, instead of showing up as a column
 * name in front of somebody. A new column of the foundation fails in the test
 * of the foundation first, and in that of every application after.
 */
export async function auditVocabularyGaps(
  pool: Pool,
  vocabulary: AuditVocabulary,
): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string; column_name: string; trigger: string }>(
    `select c.table_name, c.column_name, t.trigger_name as trigger
       from information_schema.columns c
       join (select distinct event_object_table, trigger_name
               from information_schema.triggers
              where trigger_schema = 'public'
                and trigger_name in ('audit_changes', 'instance_changes')) t
         on t.event_object_table = c.table_name
      where c.table_schema = 'public'
      order by c.table_name, c.ordinal_position`,
  )

  const columns = new Map<string, string[]>()
  const tenantLog = new Set<string>()
  const instanceLog = new Set<string>()

  for (const row of rows) {
    const known = columns.get(row.table_name) ?? []

    if (!known.includes(row.column_name)) {
      columns.set(row.table_name, [...known, row.column_name])
    }

    ;(row.trigger === 'audit_changes' ? tenantLog : instanceLog).add(row.table_name)
  }

  const language = auditLanguage(vocabulary)
  const gaps: string[] = []
  const has = (table: string, column: string) => columns.get(table)?.includes(column) ?? false
  const anywhere = (column: string) =>
    [...columns.values()].some((ofTable) => ofTable.includes(column))

  for (const table of tenantLog) {
    if (!(table in language.tables)) {
      gaps.push(`table ${table} is watched and has no words`)
    }
  }

  // Words for a table of the application that nobody watches are left over.
  // Those of the foundation are not: an application makes some of its tables
  // only once it needs them, the settings of a tenant for one.
  for (const table of Object.keys(vocabulary.tables)) {
    if (!tenantLog.has(table)) {
      gaps.push(`table ${table} has words and is not watched`)
    }
  }

  for (const table of Object.keys(vocabulary.tables)) {
    if ((foundationAuditTables as readonly string[]).includes(table)) {
      gaps.push(`table ${table} belongs to the foundation, which names it`)
    }
  }

  for (const table of instanceLog) {
    if (!(table in language.tables) && !(table in language.instanceTables)) {
      gaps.push(`table ${table} is watched by the log of the instance and has no words`)
    }
  }

  for (const table of Object.keys(language.instanceTables)) {
    if (!instanceLog.has(table)) {
      gaps.push(`table ${table} of the instance has words and is not watched`)
    }
  }

  for (const [table, ofTable] of columns) {
    for (const column of ofTable) {
      if (language.fieldName(table, column) === null) {
        gaps.push(`column ${table}.${column} has no name`)
      }
    }
  }

  for (const [table, parts] of Object.entries(vocabulary.parts)) {
    if (!tenantLog.has(table)) {
      gaps.push(`parts of ${table}, which is not watched`)
    }

    for (const part of parts) {
      if (!tenantLog.has(part.table) || !has(part.table, part.column)) {
        gaps.push(`part ${part.table}.${part.column} of ${table}`)
      }
    }
  }

  for (const table of vocabulary.records) {
    if (!tenantLog.has(table)) {
      gaps.push(`record ${table}, which is not watched`)
    }
  }

  for (const table of tenantLog) {
    if (!language.titleFields(table).some((field) => has(table, field))) {
      gaps.push(`title of ${table}: none of its naming fields exists`)
    }
  }

  for (const table of Object.keys(vocabulary.titles)) {
    if (!tenantLog.has(table)) {
      gaps.push(`title of ${table}, which is not watched`)
    }
  }

  for (const [column, target] of Object.entries(vocabulary.references)) {
    if (!tenantLog.has(target) || !anywhere(column)) {
      gaps.push(`reference ${column} to ${target}`)
    }
  }

  for (const column of vocabulary.personFields) {
    if (!anywhere(column)) {
      gaps.push(`person field ${column}, which no watched table has`)
    }
  }

  for (const reason of Object.keys(vocabulary.reasons)) {
    if (foundationAuditReasons.includes(reason)) {
      gaps.push(`reason ${reason} is the foundation's, which words it`)
    }
  }

  return gaps
}
