import {
  type AuditChange,
  type AuditOperation,
  auditPageSize,
  auditPersonFields,
  type AuditTitle,
  type InstanceLogPage,
} from '@opengewerk/domain'
import type { Database } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

import { accountsOf } from '../authentication/administration.js'

/**
 * The log of the instance (#188), in the shape of the log of a business, so
 * that the screen shows both the same way: a change per write, its fields
 * before and after, who and on which way. It is small, a handful of changes a
 * year, and read whole per page.
 */

interface Row {
  readonly id: string
  readonly change_id: string
  readonly table_name: string
  readonly record_id: string
  readonly operation: AuditOperation
  readonly field: string
  readonly old_value: string | null
  readonly new_value: string | null
  readonly changed_at: string
  readonly user_id: string | null
  readonly reason: string | null
  readonly database_role: string
}

export async function readInstanceLog(
  database: Database,
  asUser: string,
  before: string | null,
): Promise<InstanceLogPage> {
  const read = await database.forInstance(async (tx) => {
    // PostgreSQL has no max() over uuid. The text of a uuidv7 sorts as its
    // bytes do, and those in the order the entries were written.
    const pages = await tx.execute(sql`
      select change_id::text as change_id, max(id::text) as last
        from instance_changes
       group by change_id
       ${before === null ? sql`` : sql`having max(id::text) < ${before.toLowerCase()}`}
       order by max(id::text) desc
       limit ${auditPageSize + 1}`)
    const wanted = pages.rows as { change_id: string; last: string }[]
    const shown = wanted.slice(0, auditPageSize)

    if (shown.length === 0) {
      return { rows: [] as Row[], next: null, names: [] as { id: string; name: string }[] }
    }

    const entries = await tx.execute(sql`
      select id::text as id, change_id::text as change_id, table_name, record_id, operation, field,
             old_value, new_value, changed_at, user_id, reason, database_role
        from instance_changes
       where change_id::text in (${sql.join(
         shown.map((change) => sql`${change.change_id}`),
         sql`, `,
       )})
       order by id`)
    // The businesses by their name today, for those still on the instance.
    const names = await tx.execute(sql`select id::text as id, name from instance_tenants()`)

    return {
      rows: entries.rows as unknown as Row[],
      next: wanted.length > auditPageSize ? (shown.at(-1)?.last ?? null) : null,
      names: names.rows as { id: string; name: string }[],
    }
  }, asUser)

  const changes = new Map<string, AuditChange>()

  for (const row of read.rows) {
    const known = changes.get(row.change_id)
    const field = { field: row.field, before: row.old_value, after: row.new_value }

    changes.set(
      row.change_id,
      known
        ? { ...known, fields: [...known.fields, field] }
        : {
            changeId: row.change_id,
            changedAt: new Date(row.changed_at).toISOString(),
            operation: row.operation,
            table: row.table_name,
            recordId: row.record_id,
            userId: row.user_id,
            deviceId: null,
            reason: row.reason,
            databaseRole: row.database_role,
            firstSequence: 0,
            lastSequence: 0,
            fields: [field],
          },
    )
  }

  const ordered = [...changes.values()].sort((one, other) =>
    other.changedAt.localeCompare(one.changedAt),
  )
  const currentNames = new Map(read.names.map((tenant) => [tenant.id, tenant.name]))
  const titles: Record<string, AuditTitle> = {}
  const people = new Set<string>()

  for (const change of ordered) {
    if (change.userId) {
      people.add(change.userId)
    }

    for (const field of change.fields) {
      for (const value of [field.before, field.after]) {
        if (value && auditPersonFields.has(field.field)) {
          people.add(value)
        }
      }
    }

    const logged = (name: string) =>
      change.fields.find((field) => field.field === name)?.after ??
      change.fields.find((field) => field.field === name)?.before ??
      null

    if (change.table === 'tenants') {
      titles[change.recordId] = {
        table: 'tenants',
        field: 'name',
        title:
          currentNames.get(change.recordId) ??
          logged('name') ??
          titles[change.recordId]?.title ??
          null,
        kind: null,
      }
    } else if (change.table === 'instance_operators') {
      const person = logged('user_id') ?? titles[change.recordId]?.title ?? null

      titles[change.recordId] = { table: change.table, field: 'user_id', title: person, kind: null }
    } else {
      titles[change.recordId] = { table: change.table, field: null, title: null, kind: null }
    }
  }

  // An operator named in an earlier change keeps the name from there.
  for (const change of ordered) {
    const title = titles[change.recordId]

    if (change.table === 'instance_operators' && title?.title === null) {
      const found = read.rows.find(
        (row) => row.record_id === change.recordId && row.field === 'user_id',
      )

      titles[change.recordId] = { ...title, title: found?.new_value ?? found?.old_value ?? null }
    }
  }

  for (const title of Object.values(titles)) {
    if (title.field === 'user_id' && title.title) {
      people.add(title.title)
    }
  }

  const accounts = await accountsOf(database, [...people], asUser)

  return {
    changes: ordered,
    next: read.next,
    titles,
    people: Object.fromEntries([...accounts].map(([id, account]) => [id, account.name])),
    devices: {},
  }
}
