import {
  type AuditChainReport,
  type AuditChange,
  type AuditOperation,
  type AuditPage,
  auditPageSize,
  auditParts,
  auditPersonFields,
  auditReferences,
  auditTitleFields,
  auditTitleFrom,
  type AuditTitle,
  type TenantId,
} from '@opengewerk/domain'
import { and, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'

import { accountsOf } from '../authentication/administration.js'
import { verifyAuditChain } from '../database/audit.js'
import type { Database, TenantTransaction } from '../database/database.js'
import { authSessions } from '../database/schema/index.js'

/**
 * Reading the change log (#285): a page of changes with the names it needs,
 * the parts of one record, and the check of the chain.
 *
 * Everything here reads `audit_entries` and nothing else of the business. The
 * names come from the log as well, from the values a record last carried: a
 * record that is deleted, or marked so, keeps its history, and the history
 * keeps its name.
 */

/** What the owner narrowed the log to. Every part is optional. */
export interface AuditFilter {
  /** The first and last day, in Berlin, as ISO days. */
  readonly since: string | null
  readonly until: string | null
  readonly userId: string | null
  readonly table: string | null
  /** One record and its parts, when the log is opened from the record. */
  readonly record: { readonly table: string; readonly id: string } | null
  /** Only changes before this place in the chain: the page after the one that handed it out. */
  readonly before: number | null
}

/** A list of values as one array parameter, the way `device-scope.ts` passes its ids. */
function textArray(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`array[]::text[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`
}

/** One record in the log: its table and its id. */
interface Place {
  readonly table: string
  readonly id: string
}

function placeKey(place: Place): string {
  return `${place.table}:${place.id}`
}

/**
 * A record and every part of it, walked down level by level through
 * `auditParts`: a customer and its contacts, an installation and its whole
 * structure. The parts are found in the log and not in the tables, so a part
 * that is gone, or was moved to another record, is still found.
 */
export async function recordAndParts(
  tx: TenantTransaction,
  tenantId: TenantId,
  record: Place,
): Promise<Place[]> {
  const found = new Map<string, Place>([[placeKey(record), record]])
  let level: Place[] = [record]

  while (level.length > 0) {
    const next: Place[] = []
    const byTable = new Map<string, string[]>()

    for (const place of level) {
      byTable.set(place.table, [...(byTable.get(place.table) ?? []), place.id])
    }

    for (const [table, ids] of byTable) {
      for (const part of auditParts[table] ?? []) {
        const result = await tx.execute(sql`
          select distinct record_id::text as id
            from audit_entries
           where tenant_id = ${tenantId}::uuid
             and table_name = ${part.table}
             and field = ${part.column}
             and new_value = any(${textArray(ids)})`)

        for (const row of result.rows as { id: string }[]) {
          const place = { table: part.table, id: row.id }

          if (!found.has(placeKey(place))) {
            found.set(placeKey(place), place)
            next.push(place)
          }
        }
      }
    }

    level = next
  }

  return [...found.values()]
}

/** One row of the log as the page reads it. */
interface EntryRow {
  readonly change_id: string
  readonly table_name: string
  readonly record_id: string
  readonly operation: AuditOperation
  readonly field: string
  readonly old_value: string | null
  readonly new_value: string | null
  readonly changed_at: string
  readonly sequence: string | number
  readonly user_id: string | null
  readonly reason: string | null
  readonly database_role: string
}

/** How many rows one round reads. A change has at most a few dozen fields. */
const rowsPerRound = 400

/**
 * The newest changes that fit the filter, at most one page of them.
 *
 * The rows of one change sit next to each other in the chain, because the
 * trigger writes them in one go under the lock of the chain. So the page is
 * read backwards along the chain in rounds and cut into changes where the
 * change id moves on. A change is only complete once the next one has begun
 * or the log has ended, which is why a round asks for one change more than
 * the page shows.
 */
async function changesOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  filter: AuditFilter,
  places: readonly Place[] | null,
): Promise<{ changes: AuditChange[]; next: number | null }> {
  const conditions: SQL[] = [sql`tenant_id = ${tenantId}::uuid`]

  if (filter.since !== null) {
    conditions.push(
      sql`changed_at >= (${filter.since}::date)::timestamp at time zone 'Europe/Berlin'`,
    )
  }

  if (filter.until !== null) {
    conditions.push(
      sql`changed_at < ((${filter.until}::date + 1)::timestamp at time zone 'Europe/Berlin')`,
    )
  }

  if (filter.userId !== null) {
    conditions.push(sql`user_id = ${filter.userId}`)
  }

  if (filter.table !== null) {
    conditions.push(sql`table_name = ${filter.table}`)
  }

  if (places !== null) {
    conditions.push(sql`(table_name, record_id::text) in (
      select * from unnest(${textArray(places.map((place) => place.table))},
                           ${textArray(places.map((place) => place.id))}))`)
  }

  const rows: EntryRow[] = []
  let below = filter.before
  let exhausted = false
  let changeCount = 0

  while (!exhausted && changeCount <= auditPageSize) {
    const round = await tx.execute(sql`
      select change_id::text, table_name, record_id::text, operation, field, old_value, new_value,
             changed_at, sequence, user_id, reason, database_role
        from audit_entries
       where ${sql.join(conditions, sql` and `)}
         ${below === null ? sql`` : sql`and sequence < ${below}`}
       order by sequence desc
       limit ${rowsPerRound}`)
    const found = round.rows as unknown as EntryRow[]

    rows.push(...found)
    exhausted = found.length < rowsPerRound

    const last = found.at(-1)

    if (last) {
      below = Number(last.sequence)
    }

    changeCount = new Set(rows.map((row) => row.change_id)).size
  }

  const changes: AuditChange[] = []

  for (const row of rows) {
    const current = changes.at(-1)
    const sequence = Number(row.sequence)

    if (current?.changeId === row.change_id) {
      changes[changes.length - 1] = {
        ...current,
        firstSequence: Math.min(current.firstSequence, sequence),
        lastSequence: Math.max(current.lastSequence, sequence),
        fields: [
          ...current.fields,
          { field: row.field, before: row.old_value, after: row.new_value },
        ],
      }
      continue
    }

    changes.push({
      changeId: row.change_id,
      changedAt: new Date(row.changed_at).toISOString(),
      operation: row.operation,
      table: row.table_name,
      recordId: row.record_id,
      userId: row.user_id,
      deviceId: null,
      reason: row.reason,
      databaseRole: row.database_role,
      firstSequence: sequence,
      lastSequence: sequence,
      fields: [{ field: row.field, before: row.old_value, after: row.new_value }],
    })
  }

  // The rows came newest first; within a change the fields read better in
  // the order the trigger wrote them, which is the order of their names.
  const ordered = changes.map((change) => ({
    ...change,
    fields: [...change.fields].reverse(),
  }))

  if (ordered.length > auditPageSize) {
    const page = ordered.slice(0, auditPageSize)

    return { changes: page, next: page.at(-1)?.firstSequence ?? null }
  }

  // Fewer than a page: the log has ended, and the last change is complete.
  return { changes: ordered, next: null }
}

/**
 * The device each change came from.
 *
 * The trigger notes `device_id` only when it moves, so a change that does not
 * carry it came from the device of the change before it on the same record.
 * A deletion comes from nowhere the row could say: the row is gone.
 */
async function withDevices(
  tx: TenantTransaction,
  tenantId: TenantId,
  changes: readonly AuditChange[],
): Promise<AuditChange[]> {
  const own = new Map<string, string | null>()
  const missing: AuditChange[] = []

  for (const change of changes) {
    if (change.operation === 'delete') {
      own.set(change.changeId, null)
      continue
    }

    const moved = change.fields.find((field) => field.field === 'device_id')

    if (moved) {
      own.set(change.changeId, moved.after)
    } else {
      missing.push(change)
    }
  }

  if (missing.length > 0) {
    const result = await tx.execute(sql`
      select wanted.change_id, (
        select e.new_value
          from audit_entries e
         where e.tenant_id = ${tenantId}::uuid
           and e.table_name = wanted.table_name
           and e.record_id::text = wanted.record_id
           and e.field = 'device_id'
           and e.sequence < wanted.first
         order by e.sequence desc
         limit 1
      ) as device_id
        from unnest(${textArray(missing.map((change) => change.changeId))},
                    ${textArray(missing.map((change) => change.table))},
                    ${textArray(missing.map((change) => change.recordId))},
                    ${sql`array[${sql.join(
                      missing.map((change) => sql`${change.firstSequence}`),
                      sql`, `,
                    )}]::bigint[]`})
             as wanted(change_id, table_name, record_id, first)`)

    for (const row of result.rows as { change_id: string; device_id: string | null }[]) {
      own.set(row.change_id, row.device_id)
    }
  }

  return changes.map((change) => ({ ...change, deviceId: own.get(change.changeId) ?? null }))
}

/**
 * What each record is called, from the last values its naming fields carried
 * in the log, and its kind where it has one.
 */
async function titlesOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  places: readonly Place[],
): Promise<Map<string, AuditTitle>> {
  const titles = new Map<string, AuditTitle>()

  if (places.length === 0) {
    return titles
  }

  const fields = new Set<string>(['kind'])

  for (const place of places) {
    for (const field of auditTitleFields(place.table)) {
      fields.add(field)
    }
  }

  const result = await tx.execute(sql`
    select distinct on (e.table_name, e.record_id, e.field)
           e.table_name, e.record_id::text as record_id, e.field, e.new_value
      from audit_entries e
      join unnest(${textArray(places.map((place) => place.table))},
                  ${textArray(places.map((place) => place.id))}) as wanted(table_name, record_id)
        on e.table_name = wanted.table_name and e.record_id::text = wanted.record_id
     where e.tenant_id = ${tenantId}::uuid
       and e.field = any(${textArray([...fields])})
     order by e.table_name, e.record_id, e.field, e.sequence desc`)

  const latest = new Map<string, Record<string, string | null>>()

  for (const row of result.rows as {
    table_name: string
    record_id: string
    field: string
    new_value: string | null
  }[]) {
    const key = `${row.table_name}:${row.record_id}`

    latest.set(key, { ...latest.get(key), [row.field]: row.new_value })
  }

  for (const place of places) {
    const values = latest.get(placeKey(place)) ?? {}
    const titleField = auditTitleFields(place.table).find((field) => {
      const value = values[field]

      return typeof value === 'string' && value.trim() !== ''
    })

    titles.set(place.id, {
      table: place.table,
      field: place.table === 'contacts' ? null : (titleField ?? null),
      title: auditTitleFrom(place.table, values),
      kind: values['kind'] ?? null,
    })
  }

  return titles
}

/**
 * A page of the log with everything it names: the records, what their fields
 * point at, the people and the devices.
 */
export async function readAuditPage(
  database: Database,
  identity: { readonly tenantId: TenantId; readonly userId: string },
  filter: AuditFilter,
): Promise<AuditPage> {
  const read = await database.forTenant(identity, async (tx) => {
    const places =
      filter.record === null ? null : await recordAndParts(tx, identity.tenantId, filter.record)
    const { changes, next } = await changesOf(tx, identity.tenantId, filter, places)
    const withDevice = await withDevices(tx, identity.tenantId, changes)

    const named = new Map<string, Place>()
    const people = new Set<string>()

    for (const change of withDevice) {
      named.set(placeKey({ table: change.table, id: change.recordId }), {
        table: change.table,
        id: change.recordId,
      })

      if (change.userId) {
        people.add(change.userId)
      }

      for (const field of change.fields) {
        const target = auditReferences[field.field]

        for (const value of [field.before, field.after]) {
          if (value === null) {
            continue
          }

          if (target) {
            named.set(placeKey({ table: target, id: value }), { table: target, id: value })
          }

          if (auditPersonFields.has(field.field)) {
            people.add(value)
          }
        }
      }
    }

    const titles = await titlesOf(tx, identity.tenantId, [...named.values()])
    // A record named after what it belongs to needs that name as well.
    const owners = new Map<string, Place>()

    for (const title of titles.values()) {
      const target = title.field === null ? undefined : auditReferences[title.field]

      if (target && title.title && !titles.has(title.title)) {
        owners.set(placeKey({ table: target, id: title.title }), { table: target, id: title.title })
      }
    }

    for (const [id, title] of await titlesOf(tx, identity.tenantId, [...owners.values()])) {
      titles.set(id, title)
    }

    for (const title of titles.values()) {
      if (title.field !== null && auditPersonFields.has(title.field) && title.title) {
        people.add(title.title)
      }
    }

    const members = await membersAmong(tx, identity.tenantId, [...people])
    const devices = [
      ...new Set(withDevice.flatMap((change) => (change.deviceId ? [change.deviceId] : []))),
    ]

    return { changes: withDevice, next, titles, members, devices }
  })

  const accounts = await accountsOf(database, read.members, identity.userId)
  const agents = await agentsOf(database, read.devices, read.members, identity.userId)

  return {
    changes: read.changes,
    next: read.next,
    titles: Object.fromEntries(read.titles),
    people: Object.fromEntries([...accounts].map(([id, account]) => [id, account.name])),
    devices: Object.fromEntries(read.devices.map((id) => [id, agents.get(id) ?? null])),
  }
}

/**
 * Which of these ids belonged to somebody who once had a membership in this
 * business. The log of `memberships` knows everybody who ever had one, also
 * those who have left, and it is the only list the instance is asked about.
 */
export async function membersAmong(
  tx: TenantTransaction,
  tenantId: TenantId,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) {
    return []
  }

  const result = await tx.execute(sql`
    select distinct new_value as user_id
      from audit_entries
     where tenant_id = ${tenantId}::uuid
       and table_name = 'memberships'
       and field = 'user_id'
       and new_value = any(${textArray(userIds)})`)

  return (result.rows as { user_id: string }[]).map((row) => row.user_id)
}

/**
 * The browser each device last signed in with, from the sessions that are
 * still there. A device whose sessions have all ended is known only by its
 * id. Asked only for sessions of people from this business.
 */
async function agentsOf(
  database: Database,
  deviceIds: readonly string[],
  members: readonly string[],
  asUser: string,
): Promise<Map<string, string | null>> {
  if (deviceIds.length === 0 || members.length === 0) {
    return new Map()
  }

  const rows = await database.forInstance(
    (tx) =>
      tx
        .select({
          deviceId: authSessions.deviceId,
          userAgent: authSessions.userAgent,
          updatedAt: authSessions.updatedAt,
        })
        .from(authSessions)
        .where(
          and(
            inArray(authSessions.deviceId, [...deviceIds]),
            inArray(authSessions.userId, [...members]),
            isNotNull(authSessions.userAgent),
          ),
        ),
    asUser,
  )
  const newest = new Map<string, { agent: string | null; at: number }>()

  for (const row of rows) {
    if (row.deviceId === null) {
      continue
    }

    const seen = newest.get(row.deviceId)
    const at = row.updatedAt.getTime()

    if (!seen || seen.at < at) {
      newest.set(row.deviceId, { agent: row.userAgent, at })
    }
  }

  return new Map([...newest].map(([id, value]) => [id, value.agent]))
}

/**
 * The check of the chain as the owner reads it: the walk of the database
 * function, and on top what it cannot see, entries missing at the end. The
 * head of the chain says how many entries were written; fewer found means the
 * newest ones were taken away.
 */
export async function checkAuditChain(
  database: Database,
  identity: { readonly tenantId: TenantId; readonly userId: string },
  now: Date = new Date(),
): Promise<AuditChainReport> {
  return database.forTenant(identity, async (tx) => {
    const verification = await verifyAuditChain(tx, identity.tenantId)
    let { brokenAt, problem } = verification

    if (brokenAt === null) {
      const head = await tx.execute(sql`
        select next_sequence, head_hash,
               (select hash from audit_entries
                 where tenant_id = ${identity.tenantId}::uuid
                 order by sequence desc limit 1) as last_hash
          from audit_chains
         where tenant_id = ${identity.tenantId}::uuid`)
      const row = head.rows[0] as
        | { next_sequence: string | number; head_hash: string | null; last_hash: string | null }
        | undefined

      if (row) {
        const written = Number(row.next_sequence) - 1

        if (written > verification.checked) {
          brokenAt = verification.checked + 1
          problem =
            written - verification.checked === 1
              ? 'Der letzte Eintrag fehlt.'
              : `Die letzten ${String(written - verification.checked)} Einträge fehlen.`
        } else if (row.head_hash !== row.last_hash) {
          brokenAt = verification.checked
          problem = 'Der letzte Eintrag passt nicht zum Stand der Kette.'
        }
      }
    }

    let brokenAtTime: string | null = null

    if (brokenAt !== null) {
      const at = await tx.execute(sql`
        select changed_at from audit_entries
         where tenant_id = ${identity.tenantId}::uuid and sequence >= ${brokenAt}
         order by sequence limit 1`)
      const found = (at.rows[0] as { changed_at: string } | undefined)?.changed_at

      brokenAtTime = found ? new Date(found).toISOString() : null
    }

    return {
      checked: verification.checked,
      brokenAt,
      problem,
      brokenAtTime,
      checkedAt: now.toISOString(),
    }
  })
}
