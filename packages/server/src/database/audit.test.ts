import type { ChainVerification, CustomerId } from '@opengewerk/domain'
import { eq, sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { verifyAuditChain } from './audit.js'
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
  await applyMigrations()
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
    tx.insert(schema.customers).values({ tenantId: tenant.id, kind: 'business', name }).returning(),
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
    //
    // Out of it are the tables the log and the sync layer are themselves made
    // of, matched by prefix rather than by name so that the next one is
    // covered as well. The log would otherwise record its own recording, and
    // the sync layer's bookkeeping describes changes that are in the log
    // already.
    //
    // The `auth_` tables joined them in 0009, and for a different reason worth
    // keeping straight. They are not excluded because logging them would be
    // redundant but because it is impossible: an entry needs a tenant, these
    // rows belong to the instance and have none, and the trigger would fail on
    // the foreign key rather than write a wrong one. What a business may see of
    // somebody signing in is `tenant_sessions`, which does have a tenant, does
    // carry the trigger, and is covered by this test like everything else.
    const { rows } = await admin.query<{ table_name: string; triggers: string }>(
      `select c.relname as table_name,
              (select count(*) from pg_trigger t
                where t.tgrelid = c.oid and t.tgname = 'audit_changes') as triggers
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname not like 'audit\\_%'
          and c.relname not like 'sync\\_%'
          and c.relname not like 'auth\\_%'
          and c.relname <> '__drizzle_migrations'
        order by c.relname`,
    )

    expect(rows.length).toBeGreaterThanOrEqual(15)

    const unwatched = rows.filter((row) => Number(row.triggers) === 0)
    expect(unwatched).toEqual([])
  })

  it('leave the log itself alone, so that it does not log its own logging', async () => {
    const { rows } = await admin.query<{ count: string }>(
      `select count(*) from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where (c.relname like 'audit\\_%' or c.relname like 'sync\\_%'
               or c.relname like 'auth\\_%')
          and t.tgname = 'audit_changes'`,
    )

    expect(Number(rows[0]?.count)).toBe(0)
  })
})

describe('the shape of an entry', () => {
  it('is frozen, because the chain is hashed over the whole row', async () => {
    // Measured, not assumed: adding a single column makes every existing entry
    // disagree with its own fingerprint, and a chain that was sound reports a
    // break at entry one. On an installation that has been running, an upgrade
    // with one extra column here would tell the owner their audit log had been
    // tampered with.
    //
    // So this list is not a duplicate of the schema, it is the promise. If a
    // column really has to be added, the way through is a second fingerprint
    // that old entries keep being measured by, not a quiet ALTER TABLE.
    const { rows } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'audit_entries'
        order by column_name`,
    )

    expect(rows.map((row) => row.column_name)).toEqual([
      'change_id',
      'changed_at',
      'database_role',
      'field',
      'hash',
      'id',
      'new_value',
      'old_value',
      'operation',
      'previous_hash',
      'reason',
      'record_id',
      'sequence',
      'table_name',
      'tenant_id',
      'user_id',
    ])
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
          sequence: 1,
          hash: 'erfunden',
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

    // And the other half of the pair. The open policy lets the trigger write
    // from any path; the restrictive one keeps the application inside its own
    // tenant no matter what else permits, because restrictive policies are
    // combined with AND and cannot be widened by another policy.
    for (const table of ['audit_entries', 'audit_chains']) {
      const policies = await admin.query<{
        name: string
        permissive: string
        to_public: boolean
      }>(
        `select p.polname as name,
                p.polpermissive as permissive,
                (0 = any(p.polroles)) as to_public
           from pg_policy p
          where p.polrelid = $1::regclass
          order by p.polname`,
        [table],
      )

      expect(policies.rows).toEqual([
        { name: 'tenant_isolation', permissive: false, to_public: false },
        { name: 'written_by_trigger', permissive: true, to_public: true },
      ])
    }
  })

  it('does not let one company count how much another one is doing', async () => {
    await createCustomer('Zählbar GmbH')

    const chains = await database.forTenant({ tenantId: other.id }, (tx) =>
      tx.select().from(schema.auditChains),
    )

    // The chain table carries one row per tenant, and its counter says how
    // much a company has been doing. The policy that lets the trigger write
    // from any path is open to everyone, so without the restrictive policy
    // beside it this read would enumerate every tenant on the instance.
    expect(chains.every((chain) => chain.tenantId === other.id)).toBe(true)
  })

  it('shows a tenant only its own entries', async () => {
    const customerId = await createCustomer('Geheim GmbH')

    const seenByOther = await database.forTenant({ tenantId: other.id }, (tx) =>
      tx.select().from(schema.auditEntries).where(eq(schema.auditEntries.recordId, customerId)),
    )

    // Rights say what somebody may do, row level security says whose data it
    // happens to. The log is data like any other, and a change log that leaked
    // across tenants would be the worst of the tables to leak: it holds the
    // old values as well as the new ones.
    expect(seenByOther).toEqual([])
    expect(await entriesFor(customerId)).not.toEqual([])
  })
})

describe('the chain over the entries', () => {
  /**
   * Reaches past the bolt, lets the check look at the damage, and puts
   * everything back.
   *
   * Turning the trigger off is what somebody with rights on the database does
   * first, and it is the only way to get at an entry at all: the chain answers
   * precisely that move, not a polite UPDATE. It all happens inside one
   * transaction that is rolled back, which in PostgreSQL takes the disabled
   * trigger back with it. Without that, the first of these tests would leave
   * the chain broken and every later one would keep reporting its break
   * instead of its own.
   */
  async function whileBroken(
    damage: (run: (statement: string, values: unknown[]) => Promise<unknown>) => Promise<void>,
  ): Promise<ChainVerification> {
    const client = await admin.connect()

    try {
      await client.query('begin')
      await client.query('alter table audit_entries disable trigger "audit_entries_stay"')

      await damage((statement, values) => client.query(statement, values))

      const { rows } = await client.query<{
        checked: string
        broken_at: string | null
        problem: string | null
      }>('select * from verify_audit_chain($1)', [tenant.id])

      return {
        checked: Number(rows[0]?.checked),
        brokenAt: rows[0]?.broken_at == null ? null : Number(rows[0].broken_at),
        problem: rows[0]?.problem ?? null,
      }
    } finally {
      await client.query('rollback')
      client.release()
    }
  }

  async function nameEntryOf(name: string) {
    const customerId = await createCustomer(name)
    const [entry] = (await entriesFor(customerId)).filter((row) => row.field === 'name')

    if (!entry) {
      throw new Error('Nothing was logged')
    }

    return entry
  }

  it('links every entry to the one before it', async () => {
    await createCustomer('Kettenglied GmbH')

    const entries = await database.forTenant({ tenantId: tenant.id }, (tx) =>
      tx.select().from(schema.auditEntries).orderBy(schema.auditEntries.sequence),
    )

    expect(entries.length).toBeGreaterThan(3)
    expect(entries[0]?.sequence).toBe(1)
    expect(entries[0]?.previousHash).toBeNull()

    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index]?.sequence).toBe(index + 1)
      expect(entries[index]?.previousHash).toBe(entries[index - 1]?.hash)
    }
  })

  it('counts its own entries and finds nothing wrong with them', async () => {
    const sound = await database.forTenant({ tenantId: tenant.id }, (tx) =>
      verifyAuditChain(tx, tenant.id),
    )

    expect(sound.brokenAt).toBeNull()
    expect(sound.problem).toBeNull()
    // Not a vacuous yes. An empty chain checks out too, so the number matters.
    expect(sound.checked).toBeGreaterThan(3)
  })

  it('notices a value that was changed afterwards', async () => {
    const entry = await nameEntryOf('Echt GmbH')

    const broken = await whileBroken(async (run) => {
      await run('update audit_entries set new_value = $1 where id = $2', ['Gefälscht', entry.id])
    })

    expect(broken.brokenAt).toBe(entry.sequence)
    expect(broken.problem).toMatch(/verändert/)
  })

  it('notices an entry that was removed', async () => {
    const entry = await nameEntryOf('Verschwunden GmbH')

    const broken = await whileBroken(async (run) => {
      await run('delete from audit_entries where id = $1', [entry.id])
    })

    expect(broken.brokenAt).toBe(entry.sequence)
    expect(broken.problem).toMatch(/fehlt/)
  })

  it('still notices when the forged entry is given a matching hash of its own', async () => {
    const entry = await nameEntryOf('Sorgfältig GmbH')

    // This is what makes it a chain rather than a checksum per row. Somebody
    // who changes a value and recomputes that one hash has an entry that is
    // consistent with itself, and the next entry still points at the old one.
    // Covering the tracks means rewriting everything that follows.
    const broken = await whileBroken(async (run) => {
      await run('update audit_entries set new_value = $1 where id = $2', ['Gefälscht', entry.id])
      await run(
        `update audit_entries u
            set hash = (select audit_fingerprint(e) from audit_entries e where e.id = u.id)
          where u.id = $1`,
        [entry.id],
      )

      const { rows } = (await run(
        'select hash = audit_fingerprint(e) as fits from audit_entries e where id = $1',
        [entry.id],
      )) as { rows: { fits: boolean }[] }

      // The forged entry really does add up on its own now, otherwise the
      // check below would be catching the wrong thing.
      expect(rows[0]?.fits).toBe(true)
    })

    expect(broken.brokenAt).toBe(entry.sequence + 1)
    expect(broken.problem).toMatch(/Vorgänger/)
  })

  it('hashes the link as well, so that the two checks overlap on purpose', async () => {
    const entry = await nameEntryOf('Verkettet GmbH')

    const broken = await whileBroken(async (run) => {
      // Only the link, not a single other field.
      await run("update audit_entries set previous_hash = repeat('0', 64) where id = $1", [
        entry.id,
      ])

      const { rows } = (await run(
        'select hash = audit_fingerprint(e) as fits from audit_entries e where id = $1',
        [entry.id],
      )) as { rows: { fits: boolean }[] }

      // The fingerprint covers previous_hash, so touching the link alone
      // already makes the entry disagree with itself. The walk would notice
      // the broken link anyway, and that is the point: the two checks overlap
      // deliberately, so loosening one of them does not open a door. Without
      // this test the overlap is the kind of thing somebody removes as
      // duplication, and nothing goes red.
      expect(rows[0]?.fits).toBe(false)
    })

    expect(broken.brokenAt).toBe(entry.sequence)
  })

  it('holds when several people write at the same moment', async () => {
    const before = await database.forTenant({ tenantId: tenant.id }, (tx) =>
      verifyAuditChain(tx, tenant.id),
    )

    // Twelve transactions on twelve connections, started together. Each one
    // wants a place in the same chain, and a chain has exactly one order, so
    // they have to be handed through one at a time. Two that chained off the
    // same predecessor would leave a fork, and a fork is not a chain.
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => createCustomer(`Gleichzeitig ${index} GmbH`)),
    )

    const entries = await database.forTenant({ tenantId: tenant.id }, (tx) =>
      tx.select().from(schema.auditEntries).orderBy(schema.auditEntries.sequence),
    )

    const sequences = entries.map((entry) => entry.sequence)
    expect(sequences).toEqual(Array.from({ length: entries.length }, (_, index) => index + 1))
    expect(new Set(sequences).size).toBe(entries.length)

    const after = await database.forTenant({ tenantId: tenant.id }, (tx) =>
      verifyAuditChain(tx, tenant.id),
    )
    expect(after.brokenAt).toBeNull()
    expect(after.checked).toBeGreaterThan(before.checked)
  })

  it('checks out the same way in any time zone', async () => {
    // jsonb renders a timestamp in the session time zone, so an entry hashed
    // in Berlin would come out differently in Sydney and a sound chain would
    // look broken abroad. The fingerprint pins UTC for exactly that reason,
    // and this is what says so.
    const elsewhere = await database.forTenant({ tenantId: tenant.id }, async (tx) => {
      await tx.execute(sql`set local time zone 'Australia/Sydney'`)

      return verifyAuditChain(tx, tenant.id)
    })

    expect(elsewhere.brokenAt).toBeNull()
    expect(elsewhere.checked).toBeGreaterThan(3)
  })

  it('runs per tenant, so one company cannot be checked into another', async () => {
    const seenByOther = await database.forTenant({ tenantId: other.id }, (tx) =>
      verifyAuditChain(tx, tenant.id),
    )

    // Row level security means the other tenant sees none of these entries, so
    // the walk finds nothing rather than reporting on somebody else's chain.
    expect(seenByOther.checked).toBe(0)
  })
})
