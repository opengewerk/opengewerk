import type { CustomerId } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Database } from './database.js'
import { newId } from './identifier.js'
import * as schema from './schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applicationRole,
  applyMigrations,
  connect,
  insufficientPrivilege,
  refusedBy,
  resetSchema,
} from './test-database.js'

/**
 * The log has to hold under the condition that makes every other approach
 * fail: somebody changing data without going through the application. That is
 * why these tests write the same row twice, once through the server and once
 * straight into the database, and expect both to show up.
 */

const tenant = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }
const other = { id: newId<'tenant'>(), name: 'Elektro Süd GmbH' }

let admin: Pool
let database: Database

/** The log's own error class. */
const logIsAppendOnly = 'OG002'

/** Somebody in the office, with a right that says what they are doing. */
const clerk = { tenantId: tenant.id, userId: 'benutzer-buero', reason: 'customer.write' }

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations(admin)
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    tenant.id,
    tenant.name,
    other.id,
    other.name,
  ])

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

async function createCustomer(name: string): Promise<CustomerId> {
  const [created] = await database.forTenant(clerk, (tx) =>
    tx
      .insert(schema.customers)
      .values({ tenantId: tenant.id, kind: 'business', name })
      .returning(),
  )

  if (!created) {
    throw new Error('No customer came back')
  }

  return created.id
}

/** The log as the tenant sees it, which is the only way it is ever read. */
async function entriesFor(recordId: string) {
  return database.forTenant({ tenantId: tenant.id }, (tx) =>
    tx
      .select()
      .from(schema.auditEntries)
      .where(eq(schema.auditEntries.recordId, recordId))
      .orderBy(schema.auditEntries.changedAt, schema.auditEntries.field),
  )
}

describe('the tables', () => {
  it('all carry the trigger that writes the log', async () => {
    // Asked of the catalog, not of a list here. A list would be the same
    // mistake the trigger exists to avoid: complete on the day it is written
    // and quietly short one entry afterwards. A table added by a later
    // migration without the trigger makes this red, which is the moment to
    // notice it.
    const { rows } = await admin.query<{ table_name: string; triggers: string }>(
      `select c.relname as table_name,
              (select count(*) from pg_trigger t
                where t.tgrelid = c.oid and t.tgname = 'audit_changes') as triggers
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname not in ('audit_entries', '__drizzle_migrations')
        order by c.relname`,
    )

    expect(rows.length).toBeGreaterThanOrEqual(15)

    const unwatched = rows.filter((row) => Number(row.triggers) === 0)
    expect(unwatched).toEqual([])
  })

  it('leave the log itself alone, so that it does not log its own logging', async () => {
    const { rows } = await admin.query<{ count: string }>(
      `select count(*) from pg_trigger
        where tgrelid = 'audit_entries'::regclass and tgname = 'audit_changes'`,
    )

    expect(Number(rows[0]?.count)).toBe(0)
  })
})

describe('a change through the application', () => {
  it('lands in the log field by field, with who and why', async () => {
    const customerId = await createCustomer('Meier Elektrotechnik')
    const entries = await entriesFor(customerId)

    const byField = new Map(entries.map((entry) => [entry.field, entry]))

    expect(byField.get('name')).toMatchObject({
      tableName: 'customers',
      operation: 'insert',
      oldValue: null,
      newValue: 'Meier Elektrotechnik',
      userId: 'benutzer-buero',
      reason: 'customer.write',
      databaseRole: applicationRole,
    })
    expect(byField.get('kind')?.newValue).toBe('business')

    // A column that stayed empty is not a change. Logging it would bury the
    // three lines that matter under the nineteen a customer has.
    expect(byField.has('email')).toBe(false)

    // One change, one id across all of its fields. That is what makes "and
    // what else moved at the same moment" answerable.
    expect(new Set(entries.map((entry) => entry.changeId)).size).toBe(1)
  })

  it('logs the field that changed and not the rest of the row', async () => {
    const customerId = await createCustomer('Vorher GmbH')
    const before = await entriesFor(customerId)

    await database.forTenant(clerk, (tx) =>
      tx
        .update(schema.customers)
        .set({ name: 'Nachher GmbH', updatedAt: new Date() })
        .where(eq(schema.customers.id, customerId)),
    )

    const added = (await entriesFor(customerId)).slice(before.length)

    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      operation: 'update',
      field: 'name',
      oldValue: 'Vorher GmbH',
      newValue: 'Nachher GmbH',
    })
  })

  it('writes nothing when an update changes nothing', async () => {
    const customerId = await createCustomer('Unverändert GmbH')
    const before = await entriesFor(customerId)

    await database.forTenant(clerk, (tx) =>
      tx
        .update(schema.customers)
        .set({ name: 'Unverändert GmbH', updatedAt: new Date() })
        .where(eq(schema.customers.id, customerId)),
    )

    // `updated_at` moved and nothing else did. Its whole statement is "there
    // was a change here", and the log says that better or not at all.
    expect(await entriesFor(customerId)).toHaveLength(before.length)
  })

  it('keeps the history of a record that no longer exists', async () => {
    const customerId = await createCustomer('Gelöscht GmbH')

    await database.forTenant(clerk, (tx) =>
      tx.delete(schema.customers).where(eq(schema.customers.id, customerId)),
    )

    const entries = await entriesFor(customerId)
    const removal = entries.filter((entry) => entry.operation === 'delete')

    expect(removal.length).toBeGreaterThan(0)
    expect(removal.find((entry) => entry.field === 'name')).toMatchObject({
      oldValue: 'Gelöscht GmbH',
      newValue: null,
    })

    // The insert is still there. A log that loses the history with the record
    // answers no question anybody would ask it.
    expect(entries.some((entry) => entry.operation === 'insert')).toBe(true)
  })
})

describe('a change past the application', () => {
  it('lands in the log all the same, and says there was no user', async () => {
    const customerId = await createCustomer('Konsole GmbH')

    // The whole point of the trigger. This connection is the table owner and
    // knows nothing of tenants, users or reasons, which is exactly what a
    // migration or somebody at a psql prompt looks like.
    await admin.query('update customers set name = $1 where id = $2', [
      'Von Hand umbenannt',
      customerId,
    ])

    const entries = await entriesFor(customerId)
    const changed = entries.filter((entry) => entry.field === 'name')

    expect(changed).toHaveLength(2)
    expect(changed[1]).toMatchObject({
      operation: 'update',
      oldValue: 'Konsole GmbH',
      newValue: 'Von Hand umbenannt',
      userId: null,
      reason: null,
    })
    // The missing user is not a gap: the role says the change did not come
    // through the application, and that is the finding.
    expect(changed[1]?.databaseRole).not.toBe(applicationRole)
  })
})

describe('the log', () => {
  it('cannot be changed, not even by the owner of the table', async () => {
    const customerId = await createCustomer('Unbestechlich GmbH')
    const [entry] = await entriesFor(customerId)
    if (!entry) {
      throw new Error('Nothing was logged')
    }

    const changed = await refusedBy(
      admin.query('update audit_entries set new_value = $1 where id = $2', ['gefälscht', entry.id]),
    )
    expect(changed.code).toBe(logIsAppendOnly)

    const { rows } = await admin.query<{ new_value: string }>(
      'select new_value from audit_entries where id = $1',
      [entry.id],
    )
    expect(rows[0]?.new_value).toBe(entry.newValue)
  })

  it('cannot be deleted', async () => {
    const customerId = await createCustomer('Bleibt GmbH')
    const [entry] = await entriesFor(customerId)

    const deleted = await refusedBy(
      admin.query('delete from audit_entries where id = $1', [entry?.id]),
    )
    expect(deleted.code).toBe(logIsAppendOnly)
  })

  it('cannot be emptied in one go either', async () => {
    // Its own trigger, because TRUNCATE never touches the rows one by one and
    // a row trigger therefore never fires. Without this, the entire log is one
    // statement away.
    const emptied = await refusedBy(admin.query('truncate audit_entries'))
    expect(emptied.code).toBe(logIsAppendOnly)
  })

  it('cannot be written by the application at all', async () => {
    const forged = await refusedBy(
      database.forTenant(clerk, (tx) =>
        tx.insert(schema.auditEntries).values({
          tenantId: tenant.id,
          changeId: newId<'audit-change'>(),
          tableName: 'customers',
          recordId: newId<'customer'>(),
          operation: 'update',
          field: 'name',
          oldValue: 'nie passiert',
          newValue: 'auch nicht',
          databaseRole: applicationRole,
        }),
      ),
    )

    // Refused for want of a privilege, not by a policy. The application role
    // has SELECT on this table and nothing else, so a forged entry does not
    // get as far as the policy that lets the trigger through.
    expect(forged.code).toBe(insufficientPrivilege)
  })

  it('is open for the trigger to write and closed for everyone else', async () => {
    const { rows } = await admin.query<{
      can_read: boolean
      can_insert: boolean
      can_update: boolean
      can_delete: boolean
    }>(
      `select has_table_privilege($1, 'audit_entries', 'SELECT') as can_read,
              has_table_privilege($1, 'audit_entries', 'INSERT') as can_insert,
              has_table_privilege($1, 'audit_entries', 'UPDATE') as can_update,
              has_table_privilege($1, 'audit_entries', 'DELETE') as can_delete`,
      [applicationRole],
    )

    expect(rows[0]).toEqual({
      can_read: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    })

    // The other half of the pair, and the one the tests cannot exercise: the
    // database in these tests belongs to a superuser, for whom row level
    // security never applies, so the trigger would get its row written even
    // without a policy. On an installation where the migrations run as an
    // ordinary owner it would not. Checking that the policy is there is the
    // only way to keep that difference from being found in production.
    const policies = await admin.query<{ to_public: boolean; with_check: string }>(
      `select (0 = any(p.polroles)) as to_public,
              pg_get_expr(p.polwithcheck, p.polrelid) as with_check
         from pg_policy p
        where p.polrelid = 'audit_entries'::regclass and p.polcmd = 'a'`,
    )

    expect(policies.rows).toEqual([{ to_public: true, with_check: 'true' }])
  })

  it('shows a tenant only its own entries', async () => {
    const customerId = await createCustomer('Geheim GmbH')

    const seenByOther = await database.forTenant({ tenantId: other.id }, (tx) =>
      tx
        .select()
        .from(schema.auditEntries)
        .where(eq(schema.auditEntries.recordId, customerId)),
    )

    // Rights say what somebody may do, row level security says whose data it
    // happens to. The log is data like any other, and a change log that leaked
    // across tenants would be the worst of the tables to leak: it holds the
    // old values as well as the new ones.
    expect(seenByOther).toEqual([])
    expect(await entriesFor(customerId)).not.toEqual([])
  })
})
