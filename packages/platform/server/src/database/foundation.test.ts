import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'

import type { TenantId } from '@opengewerk/platform-domain'
import { eq, sql } from 'drizzle-orm'
import { isPgEnum } from 'drizzle-orm/pg-core'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { statementBreakpoint } from '../migration/blocks.js'
import { foundationGuards } from '../migration/guards.js'
import * as schema from '../schema.js'
import { Database } from './database.js'
import { everyTenant } from './every-tenant.js'
import { foundationMigration } from './foundation-migration.js'
import { newId } from './identifier.js'
import { probeDatabase, probeMigrations } from './probe-database.js'
import {
  auditEntryColumns,
  keysBetweenTenantTables,
  foundationDefinerFunctions,
  instanceLogCoverage,
  logCoverage,
  readDefinerFunctions,
  readPolicies,
  tableProtections,
  unprotected,
  unstampedTables,
  withoutTheTenant,
} from './tenant-checks.js'
import {
  allowApplicationLogin,
  columnNames,
  enumNames,
  enumValues,
  functionNames,
  insufficientPrivilege,
  refusedBy,
  tableNames,
} from './test-database.js'

// The foundation as a new application gets it: built on an empty database from
// its building blocks alone, through the runner and as the role every
// migration runs as. No table of an application is anywhere near.
//
// Two things are held here. The catalogue: what the blocks build is guarded
// the way the kit demands of every application. And that it works: a function
// in a block is only checked for its syntax when it is created, so a block
// that names a table wrongly would build without a word and fail on the first
// tenant. That the blocks are the same as what the migrations of the trades
// application arrived at is a third question, asked there, against its own
// database.

const emptyFolder = probeMigrations([])
const kit = probeDatabase(emptyFolder)

let admin: Pool
let database: Database

/** The setup refuses with this once an instance has a tenant or an account. */
const alreadySetUp = 'OG003'

/** A person on the instance, written the way the sign up writes one. */
async function account(name: string): Promise<string> {
  const id = `user-${name}`

  await database.forInstance((tx) =>
    tx.insert(schema.authUsers).values({ id, name, email: `${name}@example.org` }),
  )

  return id
}

async function errorCode(work: Promise<unknown>): Promise<string> {
  return (await refusedBy(work)).code
}

beforeAll(async () => {
  admin = await kit.connect()
  await kit.resetSchema(admin)
  await kit.applyFoundation()
  await allowApplicationLogin(admin)

  database = Database.connect(kit.applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await kit.resetSchema(admin)
  await admin.end()
  rmSync(emptyFolder, { recursive: true, force: true })
})

describe('the foundation, built from its building blocks alone', () => {
  it('is the tables that are described, the functions of the blocks and nothing else', async () => {
    expect(await tableNames(admin)).toEqual(foundationGuards.map((guard) => guard.table).sort())
    expect(await enumNames(admin)).toEqual([
      'audit_operation',
      'conflict_reason',
      'mail_security',
      'operation_outcome',
      'sign_in_method',
    ])
    // Three of them keep tables an application makes: two the versions of a
    // file (`attachmentsSchema`), one a blocked label blocked (`labelColumns`).
    // The functions come with the blocks, so that they are the same wherever
    // such a table stands.
    expect(await functionNames(admin)).toEqual([
      'attachment_may_go',
      'attachment_purging',
      'attachment_version_stays_as_written',
      'audit_entry_problem',
      'audit_entry_stays',
      'audit_fingerprint',
      'audit_redaction_applied',
      'audit_redaction_checked',
      'audit_value_commitment',
      'audit_value_digest',
      'audit_witness',
      'create_first_tenant',
      'create_tenant',
      'every_tenant',
      'file_goes_with_its_document',
      'files_held',
      'instance_change_stays',
      'instance_is_empty',
      'invitation_for',
      'keep_label_blocked',
      'next_sync_sequence',
      'purge_attachment',
      'record_attachment_uploader',
      'record_change',
      'record_instance_change',
      'stamp_sync_columns',
      'tenant_role_stays_whole',
      'tenants_with_leads',
      'verify_audit_chain',
      'version_takes_its_files',
    ])
  })

  it('says in its enums what the code says', async () => {
    const inDatabase = await enumValues(admin)
    const declared = Object.values(schema).filter((entry) => isPgEnum(entry))

    expect(declared).toHaveLength(5)

    for (const entry of declared) {
      expect({ [entry.enumName]: inDatabase.get(entry.enumName) }).toEqual({
        [entry.enumName]: [...entry.enumValues],
      })
    }
  })

  it('keeps every table from the owner and opens it to the application', async () => {
    const tables = await tableProtections(admin)

    expect(tables).toHaveLength(31)
    expect(unprotected(tables)).toEqual([])
  })

  it('finds a table of the foundation that was opened to every role', async () => {
    // The check itself, seen red once. The application role reads the table
    // either way, so "granted" says nothing; what gives it away is the list
    // of rights, where PUBLIC stands as a grantee of its own.
    const open = async () => unprotected(await tableProtections(admin)).map((table) => table.table)

    await admin.query('grant select on "memberships" to public')

    try {
      expect(await open()).toEqual(['memberships'])
    } finally {
      await admin.query('revoke select on "memberships" from public')
    }

    expect(await open()).toEqual([])
  })

  it('lets the application past the tenant only where the list says why', async () => {
    const reading = await readPolicies(admin)

    // The twenty-one tables of the foundation that carry a tenant, `tenants` among them.
    expect(reading.tables).toBe(21)
    expect(reading.violations).toEqual([])
    expect(reading.stale).toEqual([])
  })

  it('finds a policy that opens a table, when the list does not excuse it', async () => {
    // The check itself, seen red once: without the list, the two policies
    // that reach outside a tenant are exactly what it reports.
    const reading = await readPolicies(admin, {})

    expect(reading.violations.map((violation) => violation.split(' ')[0]).sort()).toEqual([
      'memberships.own_membership_outside_tenant',
      'tenants.own_tenants_outside_tenant',
    ])
  })

  it('finds the open insert of the setup the moment its fence is gone', async () => {
    // `created_by_setup` lets everybody insert a tenant, and what keeps the
    // application out is the restrictive policy beside it. The list of
    // exceptions does not name the open one, so that this is seen: without the
    // fence it is a way to create a tenant from a request.
    await admin.query('drop policy "no_application_insert" on "tenants"')

    try {
      const reading = await readPolicies(admin)

      expect(reading.violations).toEqual(['tenants.created_by_setup writes: true'])
    } finally {
      await admin.query(
        'create policy "no_application_insert" on "tenants" as restrictive for insert to "opengewerk_app" with check (false)',
      )
    }

    expect((await readPolicies(admin)).violations).toEqual([])
  })

  it('says when the list excuses a policy that is not there any more', async () => {
    const reading = await readPolicies(admin, { 'tenants.long_gone': 'a policy of an earlier day' })

    expect(reading.stale).toEqual(['tenants.long_gone'])
  })

  it('lets a function run as its definer only where the list says why, and no role call it that has no business to', async () => {
    expect(await readDefinerFunctions(admin)).toEqual({
      unexplained: [],
      stale: [],
      openToEveryRole: [],
    })
  })

  it('keeps the counter of the sync from a role that has no business with it', async () => {
    // A role as one might be added later for something else: it may enter the
    // schema and has been given nothing in it. The role is gone again with the
    // transaction.
    const client = await admin.connect()

    try {
      await client.query('begin')
      await client.query('create role "bystander"')
      await client.query('grant usage on schema "public" to "bystander"')
      await client.query('set local role "bystander"')

      expect(await errorCode(client.query('select next_sync_sequence($1)', [newId()]))).toBe(
        insufficientPrivilege,
      )
    } finally {
      await client.query('rollback')
      client.release()
    }
  })

  it('finds a function that runs as its definer and was left open to every role', async () => {
    // How the counter of the sync was created until #471: no word about who
    // may call it, which in PostgreSQL means everybody.
    await admin.query('grant execute on function "next_sync_sequence"(uuid) to public')

    try {
      expect((await readDefinerFunctions(admin)).openToEveryRole).toEqual([
        'next_sync_sequence(tenant uuid)',
      ])
    } finally {
      await admin.query('revoke execute on function "next_sync_sequence"(uuid) from public')
    }

    expect((await readDefinerFunctions(admin)).openToEveryRole).toEqual([])
  })

  it('finds every function that runs as its definer, when the list does not excuse it', async () => {
    // The check itself, seen red once: without the list, these are the ways
    // past the policies the foundation has, and with one name too many the
    // list is said to be stale.
    const reading = await readDefinerFunctions(admin, { 'long_gone()': 'of an earlier day' })

    expect(reading.unexplained).toEqual(Object.keys(foundationDefinerFunctions).sort())
    expect(reading.unexplained).toHaveLength(13)
    expect(reading.stale).toEqual(['long_gone()'])
  })

  it('runs every key between two tables of a tenant over the tenant', async () => {
    const keys = await keysBetweenTenantTables(admin)

    expect(keys.map((key) => key.key)).toEqual([
      'account_corrections_person_works_here',
      'deadline_settings_responsible_works_here',
      'file_uploads_file_in_tenant',
      'member_passkeys_person_works_here',
      'password_resets_person_works_here',
    ])
    expect(withoutTheTenant(keys)).toEqual([])
  })

  it('watches what a tenant may see of its people, its files, its mail server and its settings of deadlines and leaves the rest out of the log', async () => {
    const coverage = await logCoverage(admin)

    expect(coverage.watched).toEqual([
      'account_corrections',
      'account_mail_server_changes',
      'audit_redactions',
      'deadline_settings',
      'files',
      'invitations',
      'mail_settings',
      'member_passkeys',
      'memberships',
      'password_resets',
      'tenant_roles',
      'tenant_sessions',
      'tenants',
    ])
    expect(coverage.unwatched).toEqual([])
    expect(coverage.watchedAgainstTheList).toEqual([])
  })

  it('gives what belongs to the instance a log of its own, and the coming and going of tenants too', async () => {
    expect(await instanceLogCoverage(admin)).toEqual([
      'instance_operators',
      'instance_settings',
      'tenants',
    ])
  })

  it('finds a table whose log was switched off, of a tenant and of the instance', async () => {
    // Both triggers are still in the catalogue under their names. Asked for
    // the name alone, the two questions called these tables watched.
    await admin.query('alter table "memberships" disable trigger "audit_changes"')
    await admin.query('alter table "instance_settings" disable trigger "instance_changes"')

    try {
      const coverage = await logCoverage(admin)

      expect(coverage.unwatched).toEqual(['memberships'])
      expect(coverage.watched).not.toContain('memberships')
      expect(await instanceLogCoverage(admin)).toEqual(['instance_operators', 'tenants'])
    } finally {
      await admin.query('alter table "memberships" enable trigger "audit_changes"')
      await admin.query('alter table "instance_settings" enable trigger "instance_changes"')
    }

    expect((await logCoverage(admin)).unwatched).toEqual([])
    expect(await instanceLogCoverage(admin)).toHaveLength(3)
  })

  it('has the columns of an audit entry as they are frozen', async () => {
    expect(await columnNames(admin, 'audit_entries')).toEqual(auditEntryColumns)
  })

  it('carries no table whose rows travel without the stamp', async () => {
    expect(await unstampedTables(admin)).toEqual([])
  })
})

describe('an instance that has nothing but the foundation', () => {
  let tenantId: TenantId
  let owner: string

  it('is empty until the first run, which creates one tenant and no second', async () => {
    const empty = () =>
      database.forInstance(async (tx) => {
        const result = await tx.execute<{ empty: boolean }>(
          sql`select instance_is_empty() as empty`,
        )

        return result.rows[0]?.empty
      })

    expect(await empty()).toBe(true)

    tenantId = await database.forInstance(async (tx) => {
      const result = await tx.execute<{ id: TenantId }>(
        sql`select create_first_tenant('Probe GmbH') as id`,
      )

      return result.rows[0]?.id as TenantId
    })

    expect(await empty()).toBe(false)
    expect(
      await errorCode(
        database.forInstance((tx) => tx.execute(sql`select create_first_tenant('Zweite GmbH')`)),
      ),
    ).toBe(alreadySetUp)
  })

  it('does not let the application create a tenant past the setup', async () => {
    expect(
      await errorCode(
        database.forInstance((tx) =>
          tx.insert(schema.tenants).values({ id: newId<'tenant'>(), name: 'Am Setup vorbei' }),
        ),
      ),
    ).toBe(insufficientPrivilege)
  })

  it('writes who was let in into the log of the tenant, with who did it and why', async () => {
    owner = await account('inhaberin')

    await database.forTenant({ tenantId, userId: owner, reason: 'membership.write' }, (tx) =>
      tx.insert(schema.memberships).values({ tenantId, userId: owner, roles: ['owner'] }),
    )

    const entries = await database.forTenant({ tenantId }, (tx) =>
      tx
        .select()
        .from(schema.auditEntries)
        .where(eq(schema.auditEntries.tableName, 'memberships'))
        .orderBy(schema.auditEntries.sequence),
    )

    // One entry per field that has a value. `blocked_at` is null on both
    // sides and `updated_at` says nothing the entry does not say better.
    expect(entries.map((entry) => entry.field)).toEqual([
      'created_at',
      'id',
      'roles',
      'tenant_id',
      'user_id',
    ])
    expect(new Set(entries.map((entry) => entry.userId))).toEqual(new Set([owner]))
    expect(new Set(entries.map((entry) => entry.reason))).toEqual(new Set(['membership.write']))
    expect(entries.find((entry) => entry.field === 'roles')?.newValue).toBe('["owner"]')
  })

  it('chains the entries, the creation of the tenant among them, and finds nothing wrong', async () => {
    const verified = await database.forTenant({ tenantId }, async (tx) => {
      const result = await tx.execute<{
        checked: string
        broken_at: string | null
        problem: string | null
      }>(sql`select * from verify_audit_chain(${tenantId})`)

      return result.rows[0]
    })

    // The tenant itself: id, name and created_at. Then the membership.
    expect(Number(verified?.checked)).toBe(8)
    expect(verified?.broken_at).toBeNull()
    expect(verified?.problem).toBeNull()
  })

  it('notices an entry that was changed past the trigger', async () => {
    // As the superuser, with the bolt taken off for one statement: the only
    // way there is, and the chain is what says so afterwards.
    await admin.query('alter table audit_entries disable trigger audit_entries_stay')

    try {
      await admin.query(
        `update audit_entries set new_value = '["technician"]' where field = 'roles'`,
      )

      const verified = await database.forTenant({ tenantId }, async (tx) => {
        const result = await tx.execute<{ broken_at: string | null; problem: string | null }>(
          sql`select * from verify_audit_chain(${tenantId})`,
        )

        return result.rows[0]
      })

      expect(verified?.problem).toBe('Der Eintrag wurde nachträglich verändert.')
      expect(Number(verified?.broken_at)).toBe(6)

      await admin.query(`update audit_entries set new_value = '["owner"]' where field = 'roles'`)
    } finally {
      await admin.query('alter table audit_entries enable trigger audit_entries_stay')
    }
  })

  it('lets nobody change the log, the application not at all and the owner not either', async () => {
    expect(
      await errorCode(
        database.forTenant({ tenantId }, (tx) =>
          tx.execute(sql`update audit_entries set reason = 'forged'`),
        ),
      ),
    ).toBe(insufficientPrivilege)

    // A superuser, so that row level security is out of the way and the
    // trigger is what answers.
    expect(await errorCode(admin.query(`update audit_entries set reason = 'forged'`))).toBe('OG002')
    expect(await errorCode(admin.query('truncate audit_entries'))).toBe('OG002')
  })

  it('hands out the numbers of the sync layer one after the other', async () => {
    const next = () =>
      database.forTenant({ tenantId }, async (tx) => {
        const result = await tx.execute<{ value: string }>(
          sql`select next_sync_sequence(${tenantId}) as value`,
        )

        return Number(result.rows[0]?.value)
      })

    expect([await next(), await next(), await next()]).toEqual([1, 2, 3])
  })

  it('finds an invitation by the hash of its token, outside any tenant, and no other', async () => {
    const token = 'a-token-nobody-guesses'
    const tokenHash = createHash('sha256').update(token).digest('hex')

    await database.forTenant({ tenantId, userId: owner, reason: 'staff.write' }, (tx) =>
      tx.insert(schema.invitations).values({
        tenantId,
        email: 'neu@example.org',
        name: 'Neu Dabei',
        roles: ['office'],
        tokenHash,
        invitedBy: owner,
        expiresAt: new Date('2037-01-01T00:00:00Z'),
      }),
    )

    const invitationFor = (hash: string) =>
      database.forInstance(async (tx) => {
        const result = await tx.execute<{ company: string; invited_email: string }>(
          sql`select company, invited_email from invitation_for(${hash})`,
        )

        return result.rows
      })

    expect(await invitationFor(tokenHash)).toEqual([
      { company: 'Probe GmbH', invited_email: 'neu@example.org' },
    ])
    expect(await invitationFor(createHash('sha256').update('another').digest('hex'))).toEqual([])

    // And the table itself stays shut outside a tenant: the function is the
    // one way in.
    expect(await database.forInstance((tx) => tx.select().from(schema.invitations))).toEqual([])
  })

  it('keeps a second tenant out of the first, and names both to a job that acts for nobody', async () => {
    // Created the way whoever runs the instance does it; the application
    // cannot.
    const second = newId<'tenant'>()
    await admin.query('insert into tenants (id, name) values ($1, $2)', [second, 'Zweite GmbH'])

    const other = await account('nachbar')
    await database.forTenant(
      { tenantId: second, userId: other, reason: 'membership.write' },
      (tx) =>
        tx.insert(schema.memberships).values({ tenantId: second, userId: other, roles: ['owner'] }),
    )

    const seenByTheFirst = await database.forTenant({ tenantId }, (tx) =>
      tx.select({ userId: schema.memberships.userId }).from(schema.memberships),
    )
    const tenantsOfTheFirst = await database.forTenant({ tenantId }, (tx) =>
      tx.select({ name: schema.tenants.name }).from(schema.tenants),
    )

    expect(seenByTheFirst).toEqual([{ userId: owner }])
    expect(tenantsOfTheFirst).toEqual([{ name: 'Probe GmbH' }])
    expect(
      await errorCode(
        database.forTenant({ tenantId }, (tx) =>
          tx
            .insert(schema.memberships)
            .values({ tenantId: second, userId: owner, roles: ['owner'] }),
        ),
      ),
    ).toBe(insufficientPrivilege)

    expect([...(await everyTenant(database))].sort()).toEqual([tenantId, second].sort())
  })

  it('shows somebody outside a tenant the tenants they belong to, and their own memberships', async () => {
    const chooser = await database.forInstance(
      (tx) => tx.select({ name: schema.tenants.name }).from(schema.tenants),
      owner,
    )
    const memberships = await database.forInstance(
      (tx) => tx.select({ userId: schema.memberships.userId }).from(schema.memberships),
      owner,
    )

    expect(chooser).toEqual([{ name: 'Probe GmbH' }])
    expect(memberships).toEqual([{ userId: owner }])
  })

  // Blacking out a value of the log (ADR 0013). The owner leads through a
  // role of the tenant that leads; an entry of version 1 is made from the
  // newest entry, the way the log looks where it was written before.
  describe('a value of the log blacked out', () => {
    let reader: string
    let oldEntry: string
    let newEntry: string

    const chain = () =>
      database.forTenant({ tenantId }, async (tx) => {
        const result = await tx.execute<{
          checked: string
          broken_at: string | null
          problem: string | null
        }>(sql`select * from verify_audit_chain(${tenantId})`)

        return result.rows[0]
      })
    /** A redaction as the application writes one; `claimed` is who the row says made it, which the database does not take. */
    const redact = (
      userId: string,
      entryId: string,
      side: string,
      reason: string,
      claimed = userId,
    ) =>
      database.forTenant({ tenantId, userId, reason: 'audit.redact' }, (tx) =>
        tx
          .insert(schema.auditRedactions)
          .values({ tenantId, entryId, side, reason, redactedBy: claimed }),
      )
    const entry = async (id: string) =>
      (await admin.query('select * from audit_entries where id = $1', [id])).rows[0] as {
        old_value: string | null
        new_value: string | null
        old_value_digest: string | null
        new_value_digest: string | null
        fingerprint_version: number
      }
    /** The sides of an entry that still have a nonce. */
    const nonces = async (id: string) =>
      (
        await admin.query<{ side: string }>(
          'select side from audit_value_nonces where entry_id = $1 order by side',
          [id],
        )
      ).rows.map((row) => row.side)
    const sha256 = (value: string | null) =>
      createHash('sha256')
        .update(value ?? '')
        .digest('hex')

    it('is blacked out by whoever leads, with a reason, and the chain holds, for an entry of either version', async () => {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, 'lead', 'Leitung', '{}', true, false), ($1, 'reader', 'Lesen', '{}', false, false)`,
        [tenantId],
      )
      await admin.query(
        `update memberships set roles = '{lead}' where tenant_id = $1 and user_id = $2`,
        [tenantId, owner],
      )
      reader = await account('leserin')
      await admin.query(
        `insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{reader}')`,
        [tenantId, reader],
      )

      // The newest entry as one written before ADR 0013, and the head of the chain after it.
      await admin.query('alter table audit_entries disable trigger audit_entries_stay')

      try {
        const { rows } = await admin.query<{ id: string }>(
          `update audit_entries set fingerprint_version = 1, old_value_digest = null, new_value_digest = null
            where id = (select id from audit_entries where tenant_id = $1 and new_value is not null
                         order by sequence desc limit 1)
            returning id`,
          [tenantId],
        )

        oldEntry = rows[0]?.id ?? ''
        await admin.query('update audit_entries e set hash = audit_fingerprint(e) where id = $1', [
          oldEntry,
        ])
        await admin.query(
          `update audit_chains c set head_hash = e.hash from audit_entries e
            where e.id = $1 and c.tenant_id = e.tenant_id and c.next_sequence = e.sequence + 1`,
          [oldEntry],
        )
      } finally {
        await admin.query('alter table audit_entries enable trigger audit_entries_stay')
      }

      expect((await chain())?.problem).toBeNull()

      const { rows: written } = await admin.query<{ id: string }>(
        `select id from audit_entries where tenant_id = $1 and fingerprint_version = 3 and field = 'roles' and old_value is not null
          order by sequence desc limit 1`,
        [tenantId],
      )

      newEntry = written[0]?.id ?? ''

      const before = await entry(oldEntry)
      const fresh = await entry(newEntry)

      expect(fresh.fingerprint_version).toBe(3)
      expect(await nonces(newEntry)).toEqual(['new', 'old'])

      await redact(owner, oldEntry, 'new', 'Auskunft der Person')
      await redact(owner, newEntry, 'old', 'Auskunft der Person', reader)

      // Who blacked out a value is whoever the session names, whatever the row said.
      const { rows: authors } = await admin.query<{ redacted_by: string }>(
        'select redacted_by from audit_redactions where entry_id = $1',
        [newEntry],
      )

      expect(authors).toEqual([{ redacted_by: owner }])

      const gone = await entry(oldEntry)

      expect(gone.new_value).toBeNull()
      expect(gone.new_value_digest).toBe(
        createHash('sha256')
          .update(before.new_value ?? '')
          .digest('hex'),
      )
      expect(gone.old_value).toBe(before.old_value)

      // An entry of version 3 keeps nothing that opens what it lost: the nonce
      // went with the value, and the fingerprint that stays is not the one of
      // the value alone, so trying names and dates against it finds nothing.
      const redacted = await entry(newEntry)

      expect(redacted.old_value).toBeNull()
      expect(redacted.old_value_digest).toBe(fresh.old_value_digest)
      expect(redacted.old_value_digest).not.toBe(sha256(fresh.old_value))
      expect(await nonces(newEntry)).toEqual(['new'])

      const checked = await chain()

      expect(checked?.problem).toBeNull()
      expect(checked?.broken_at).toBeNull()

      // The redaction stands in the log itself, with its reason and without the value.
      const logged = await admin.query<{ field: string; new_value: string | null }>(
        `select field, new_value from audit_entries where tenant_id = $1 and table_name = 'audit_redactions'`,
        [tenantId],
      )

      expect(
        logged.rows.filter((row) => row.field === 'reason').map((row) => row.new_value),
      ).toEqual(['Auskunft der Person', 'Auskunft der Person'])
      expect(JSON.stringify(logged.rows)).not.toContain(before.new_value ?? '')
    })

    it('is refused to whoever does not lead, without a reason, twice, and for an entry of another tenant', async () => {
      const { rows } = await admin.query<{ id: string }>(
        `select id from audit_entries where tenant_id = $1 and fingerprint_version = 3 and new_value is not null
           and id <> $2 order by sequence limit 1`,
        [tenantId, newEntry],
      )
      const target = rows[0]?.id ?? ''

      expect(await errorCode(redact(reader, target, 'new', 'Auskunft'))).toBe(insufficientPrivilege)
      expect(await errorCode(redact(owner, target, 'new', ''))).toBe('23514')
      expect(await errorCode(redact(owner, target, 'both', 'Auskunft'))).toBe('23514')
      expect(await errorCode(redact(owner, oldEntry, 'new', 'Noch einmal'))).toBe('OG006')
      expect(await errorCode(redact(owner, newId(), 'new', 'Auskunft'))).toBe('OG006')
      expect((await entry(target)).new_value).not.toBeNull()

      // Whoever does not lead is refused before any entry is looked at, also
      // one that is not there; and a row that names another tenant as well,
      // so that whether an entry is there in it is nothing to learn here.
      expect(await errorCode(redact(reader, newId(), 'new', 'Auskunft'))).toBe(
        insufficientPrivilege,
      )
      // The person leads a second tenant as well: the row is refused for not
      // being of the tenant of the session, before an entry of the other
      // tenant is looked for.
      const second = newId()

      await admin.query(`insert into tenants (id, name) values ($1, 'Zweiter Mandant')`, [second])
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, 'lead', 'Leitung', '{}', true, false)`,
        [second],
      )
      await admin.query(
        `insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{lead}')`,
        [second, owner],
      )
      expect(
        await errorCode(
          database.forTenant({ tenantId, userId: owner, reason: 'audit.redact' }, (tx) =>
            tx.insert(schema.auditRedactions).values({
              tenantId: second as never,
              entryId: newId(),
              side: 'new',
              reason: 'Auskunft',
              redactedBy: owner,
            }),
          ),
        ),
      ).toBe(insufficientPrivilege)

      // And the policy refuses on its own, with the trigger in front of it out of the way.
      await admin.query('alter table audit_redactions disable trigger audit_redaction_checked')

      try {
        expect(await errorCode(redact(reader, target, 'new', 'Auskunft'))).toBe(
          insufficientPrivilege,
        )
      } finally {
        await admin.query('alter table audit_redactions enable trigger audit_redaction_checked')
      }

      expect((await entry(target)).new_value).not.toBeNull()
    })

    it('finds an entry changed after its value was blacked out, and a value gone without a redaction', async () => {
      await admin.query('alter table audit_entries disable trigger audit_entries_stay')

      try {
        await admin.query(`update audit_entries set reason = 'gefälscht' where id = $1`, [oldEntry])
        expect((await chain())?.problem).toBe('Der Eintrag wurde nach dem Schwärzen verändert.')
        await admin.query(`update audit_entries set reason = null where id = $1`, [oldEntry])
        expect((await chain())?.problem).toBeNull()

        const { rows } = await admin.query<{ id: string; new_value: string }>(
          `select id, new_value from audit_entries where tenant_id = $1 and fingerprint_version = 3
             and new_value is not null and id <> $2 and id <> $3 order by sequence limit 1`,
          [tenantId, newEntry, oldEntry],
        )
        const plain = rows[0]

        await admin.query('update audit_entries set new_value = null where id = $1', [plain?.id])
        expect((await chain())?.problem).toBe(
          'Ein Wert des Eintrags fehlt, ohne dass er geschwärzt wurde.',
        )
        await admin.query('update audit_entries set new_value = $2 where id = $1', [
          plain?.id,
          plain?.new_value,
        ])
        expect((await chain())?.problem).toBeNull()

        // An entry no longer as it was written is not blacked out: the redaction would hide the change.
        await admin.query(
          `update audit_entries set changed_at = changed_at + interval '1 second' where id = $1`,
          [plain?.id],
        )
        expect(await errorCode(redact(owner, plain?.id ?? '', 'new', 'Auskunft'))).toBe('OG006')
        expect((await entry(plain?.id ?? '')).new_value).toBe(plain?.new_value)
        await admin.query(
          `update audit_entries set changed_at = changed_at - interval '1 second' where id = $1`,
          [plain?.id],
        )
        expect((await chain())?.problem).toBeNull()
      } finally {
        await admin.query('alter table audit_entries enable trigger audit_entries_stay')
      }
    })

    it('lets the bolt of the log through the redaction it names and nothing else', async () => {
      const client = await admin.connect()

      try {
        await client.query('begin')
        await client.query(`select set_config('app.redacting', $1, true)`, [`${oldEntry}:old`])

        // A redaction of the old value is not written: nothing names it.
        expect(
          await errorCode(
            client.query('update audit_entries set old_value = null where id = $1', [oldEntry]),
          ),
        ).toBe('OG002')
      } finally {
        await client.query('rollback')
        client.release()
      }

      const second = await admin.connect()

      try {
        await second.query('begin')
        await second.query(`select set_config('app.redacting', $1, true)`, [`${newEntry}:old`])

        // The redaction of the old value is there, but this changes more than the value.
        expect(
          await errorCode(
            second.query(`update audit_entries set reason = 'gefälscht' where id = $1`, [newEntry]),
          ),
        ).toBe('OG002')
      } finally {
        await second.query('rollback')
        second.release()
      }
    })

    it('finds a value of version 3 that no longer fits with its nonce, or whose nonce is gone', async () => {
      const { rows } = await admin.query<{ id: string; new_value: string }>(
        `select id, new_value from audit_entries where tenant_id = $1 and fingerprint_version = 3
           and new_value is not null and id <> $2 order by sequence limit 1`,
        [tenantId, newEntry],
      )
      const plain = rows[0]
      const { rows: kept } = await admin.query<{ nonce: string }>(
        `select nonce from audit_value_nonces where entry_id = $1 and side = 'new'`,
        [plain?.id],
      )

      await admin.query('alter table audit_entries disable trigger audit_entries_stay')

      try {
        await admin.query(`update audit_entries set new_value = new_value || '!' where id = $1`, [
          plain?.id,
        ])
        expect((await chain())?.problem).toBe('Der Eintrag wurde nachträglich verändert.')
        await admin.query('update audit_entries set new_value = $2 where id = $1', [
          plain?.id,
          plain?.new_value,
        ])
        expect((await chain())?.problem).toBeNull()
      } finally {
        await admin.query('alter table audit_entries enable trigger audit_entries_stay')
      }

      await admin.query(`delete from audit_value_nonces where entry_id = $1 and side = 'new'`, [
        plain?.id,
      ])
      expect((await chain())?.problem).toBe('Der Eintrag wurde nachträglich verändert.')
      await admin.query(
        `insert into audit_value_nonces (entry_id, tenant_id, side, nonce) values ($1, $2, 'new', $3)`,
        [plain?.id, tenantId, kept[0]?.nonce],
      )
      expect((await chain())?.problem).toBeNull()
    })

    it('is read by the application in its own tenant only, and written by nobody but the trigger', async () => {
      const read = await database.forTenant({ tenantId }, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) from audit_value_nonces`),
      )

      expect(Number(read.rows[0]?.count)).toBeGreaterThan(0)

      const elsewhere = await database.forTenant({ tenantId: newId() as never }, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) from audit_value_nonces`),
      )

      expect(Number(elsewhere.rows[0]?.count)).toBe(0)
      expect(
        await errorCode(
          database.forTenant({ tenantId }, (tx) =>
            tx.execute(sql`delete from audit_value_nonces where entry_id = ${newEntry}`),
          ),
        ),
      ).toBe(insufficientPrivilege)
    })
  })
})

describe('the rollback of the foundation', () => {
  it('leaves an empty database, and the way forward open again', async () => {
    const { down } = await foundationMigration()

    await kit.resetSchema(admin)
    await kit.applyFoundation()

    // As the superuser, like every rollback: the owner sees no row under
    // FORCE, and a rollback is run by whoever runs the instance.
    for (const statement of down.split(statementBreakpoint)) {
      await admin.query(statement)
    }

    // What the database says, not a list somebody kept by hand. A function
    // left behind is the one that fails loudest and latest: the blocks create
    // without OR REPLACE, so the next run forward would stop at it.
    expect(await tableNames(admin)).toEqual([])
    expect(await enumNames(admin)).toEqual([])
    expect(await functionNames(admin)).toEqual([])

    const { rows } = await admin.query<{ schema: string | null }>(
      `select to_regnamespace('drizzle')::text as schema`,
    )
    expect(rows[0]?.schema).toBeNull()

    await kit.applyFoundation()
    expect(await tableNames(admin)).toHaveLength(31)
  })
})
