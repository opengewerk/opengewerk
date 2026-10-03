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
    expect(await functionNames(admin)).toEqual([
      'audit_entry_stays',
      'audit_fingerprint',
      'create_first_tenant',
      'create_tenant',
      'every_tenant',
      'instance_change_stays',
      'instance_is_empty',
      'invitation_for',
      'next_sync_sequence',
      'record_change',
      'record_instance_change',
      'stamp_sync_columns',
      'tenants_with_leads',
      'verify_audit_chain',
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

    expect(tables).toHaveLength(23)
    expect(unprotected(tables)).toEqual([])
  })

  it('lets the application past the tenant only where the list says why', async () => {
    const reading = await readPolicies(admin)

    // The thirteen tables of the foundation that carry a tenant, `tenants` among them.
    expect(reading.tables).toBe(13)
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

  it('lets a function run as its definer only where the list says why', async () => {
    expect(await readDefinerFunctions(admin)).toEqual({ unexplained: [], stale: [] })
  })

  it('finds every function that runs as its definer, when the list does not excuse it', async () => {
    // The check itself, seen red once: without the list, these are the ways
    // past the policies the foundation has, and with one name too many the
    // list is said to be stale.
    const reading = await readDefinerFunctions(admin, { 'long_gone()': 'of an earlier day' })

    expect(reading.unexplained).toEqual(Object.keys(foundationDefinerFunctions).sort())
    expect(reading.unexplained).toHaveLength(9)
    expect(reading.stale).toEqual(['long_gone()'])
  })

  it('runs every key between two tables of a tenant over the tenant', async () => {
    const keys = await keysBetweenTenantTables(admin)

    expect(keys.map((key) => key.key)).toEqual(['member_passkeys_person_works_here'])
    expect(withoutTheTenant(keys)).toEqual([])
  })

  it('watches what a tenant may see of its people, its files and its mail server and leaves the rest out of the log', async () => {
    const coverage = await logCoverage(admin)

    expect(coverage.watched).toEqual([
      'files',
      'invitations',
      'mail_settings',
      'member_passkeys',
      'memberships',
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
    expect(await tableNames(admin)).toHaveLength(23)
  })
})
