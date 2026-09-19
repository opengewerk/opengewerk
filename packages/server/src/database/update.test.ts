import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from './identifier.js'
import {
  MigrationHistoryError,
  migrationsFolder,
  readMigrationIndex,
  runMigrations,
} from './migrations.js'
import type { AddedMigration } from './test-database.js'
import {
  appliedMigrationCount,
  changeMigration,
  columnNames,
  connect,
  migrationsFolderUpTo,
  ownerDatabaseUrl,
  resetSchema,
  tableNames,
} from './test-database.js'

/**
 * What an update has to survive, tested the way an installation goes through
 * it: a database on the state an older release left behind, then the migration
 * run of the current one against exactly that.
 *
 * The interesting case is not the empty database. It is the one with data in
 * it, because that is where a migration first learns what it forgot, and it is
 * the state nobody can try out again afterwards.
 */

/**
 * How many migrations the older release carried. Four leaves the two that
 * follow as the ones to pass over: 0004 hangs five columns on every table that
 * holds records, 0005 brings the rule engine. Both have to get along with rows
 * that are already there.
 */
const olderRelease = 4

const tenant = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH' }

let admin: Pool
const folders: string[] = []

beforeAll(async () => {
  admin = await connect()
})

afterAll(async () => {
  await admin.end()

  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/** The migrations folder of an older release, removed again when tests end. */
function releaseFolder(count: number, ...added: AddedMigration[]): string {
  const folder = migrationsFolderUpTo(count, ...added)
  folders.push(folder)

  return folder
}

/**
 * A database on the older state, with the kind of data that makes a migration
 * fail: rows in the tables it wants to change, and an audit chain over them.
 */
async function olderInstallation(): Promise<void> {
  await resetSchema(admin)
  await runMigrations(ownerDatabaseUrl(), releaseFolder(olderRelease))

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
  await admin.query(
    "insert into customers (tenant_id, kind, name) values ($1, 'business', 'Bauherr Nord'), " +
      "($1, 'private', 'Familie Weber')",
    [tenant.id],
  )
  await admin.query("update customers set city = 'Mannheim' where name = 'Bauherr Nord'")
}

interface Chain {
  readonly nextSequence: string
  readonly headHash: string | null
}

async function chain(): Promise<Chain> {
  const { rows } = await admin.query<{ next_sequence: string; head_hash: string | null }>(
    'select next_sequence, head_hash from audit_chains where tenant_id = $1',
    [tenant.id],
  )

  const row = rows[0]

  if (!row) {
    throw new Error('The tenant has no audit chain')
  }

  return { nextSequence: row.next_sequence, headHash: row.head_hash }
}

/** What the database says about its own log: null when nothing is broken. */
async function chainProblem(): Promise<string | null> {
  const { rows } = await admin.query<{ problem: string | null }>(
    'select problem from verify_audit_chain($1)',
    [tenant.id],
  )

  return rows[0]?.problem ?? null
}

async function customerNames(): Promise<string[]> {
  const { rows } = await admin.query<{ name: string }>('select name from customers order by name')

  return rows.map((row) => row.name)
}

async function addCustomer(name: string): Promise<void> {
  await admin.query("insert into customers (tenant_id, kind, name) values ($1, 'business', $2)", [
    tenant.id,
    name,
  ])
}

/**
 * Everything the error chain says. The runner wraps the database error in one
 * of its own that repeats only the statement, so the sentence naming the
 * column sits one or two causes further down.
 */
function reasonOf(error: unknown): string {
  const sentences: string[] = []
  let current: unknown = error

  while (current instanceof Error) {
    sentences.push(current.message)
    current = (current as { cause?: unknown }).cause
  }

  return sentences.join(' | ')
}

describe('an update from an older release', () => {
  it('carries the data across two migrations and leaves the audit chain whole', async () => {
    await olderInstallation()

    expect(await appliedMigrationCount(admin)).toBe(olderRelease)
    expect(await columnNames(admin, 'customers')).not.toContain('change_sequence')

    const before = await chain()
    expect(Number(before.nextSequence)).toBeGreaterThan(3)

    // The update itself: the call the migration container makes, against the
    // folder of the current image.
    await runMigrations(ownerDatabaseUrl())

    expect(await appliedMigrationCount(admin)).toBe(readMigrationIndex().length)
    expect(await tableNames(admin)).toContain('tenant_parameters')
    expect(await columnNames(admin, 'customers')).toContain('change_sequence')
    expect(await customerNames()).toEqual(['Bauherr Nord', 'Familie Weber'])

    // The rows written before the update carry the new columns with their
    // defaults. A NOT NULL column without one would have stopped the update,
    // which is the reason to look rather than assume.
    const { rows: stamped } = await admin.query<{ version: number }>(
      'select version from customers order by name',
    )
    expect(stamped.map((row) => row.version)).toEqual([1, 1])

    // The chain is the part that cannot be repaired afterwards. Its head was
    // computed over entries the update passes over, so a column added to the
    // log itself would turn up here as a forgery.
    expect(await chain()).toEqual(before)
    expect(await chainProblem()).toBeNull()

    // And it goes on from where it stood, rather than starting again beside it.
    await addCustomer('Nach dem Update')

    expect(Number((await chain()).nextSequence)).toBeGreaterThan(Number(before.nextSequence))
    expect(await chainProblem()).toBeNull()
  })

  it('rolls the whole update back when one migration fails, and names the reason', async () => {
    await olderInstallation()

    const namesBefore = await customerNames()
    const chainBefore = await chain()

    // Two migrations, the second of which only works on an empty table. That
    // is the mistake this really guards against: a column added without a
    // default passes every development database that has no rows in it yet.
    const broken = releaseFolder(
      olderRelease,
      { tag: '0004_first_step', sql: 'CREATE TABLE "warranties" ("id" uuid PRIMARY KEY);' },
      {
        tag: '0005_second_step',
        sql: 'ALTER TABLE "customers" ADD COLUMN "credit_limit" numeric(12, 2) NOT NULL;',
      },
    )

    const failure = await runMigrations(ownerDatabaseUrl(), broken).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(reasonOf(failure)).toContain('credit_limit')

    // All or nothing. The first migration ran without complaint, and its table
    // is gone as well, because both were inside one transaction.
    expect(await tableNames(admin)).not.toContain('warranties')
    expect(await columnNames(admin, 'customers')).not.toContain('credit_limit')
    expect(await appliedMigrationCount(admin)).toBe(olderRelease)

    // Runnable, not merely unharmed: the old release goes on writing to this
    // database, and the log goes on with it.
    expect(await customerNames()).toEqual(namesBefore)
    await addCustomer('Nach dem Fehlschlag')

    expect(Number((await chain()).nextSequence)).toBeGreaterThan(Number(chainBefore.nextSequence))
    expect(await chainProblem()).toBeNull()
  })

  it('refuses to take a kind away from a board that still carries it', async () => {
    // `meter_cabinet` leaves `distribution_board_kind` in 0008. It leaves the
    // code, not a database somebody has already filled, and a cast that simply
    // went through would put such a board on a kind nobody chose for it. The
    // database refuses instead, and this is that refusal written down: the
    // whole update stops, the row keeps what it says, and the reason names the
    // value rather than the file.
    //
    // The release is looked up by the tag, not counted. A count would be right
    // today and point at the wrong migration the next time one is added.
    const beforeTheChange = readMigrationIndex().findIndex(
      (entry) => entry.tag === '0008_anlagenarten',
    )
    expect(beforeTheChange).toBeGreaterThan(0)

    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl(), releaseFolder(beforeTheChange))
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])
    await admin.query(
      `with customer as (
         insert into customers (tenant_id, kind, name)
           values ($1, 'business', 'Hausverwaltung Süd') returning id
       ), site as (
         insert into sites (tenant_id, customer_id, designation)
           select $1, id, 'Haus 4' from customer returning id
       ), installation as (
         insert into installations (tenant_id, site_id, kind, designation)
           select $1, id, 'meter_cabinet', 'Zählerschrank' from site returning id
       )
       insert into distribution_boards (tenant_id, installation_id, kind, designation)
         select $1, id, 'meter_cabinet', 'Zählerschrank' from installation`,
      [tenant.id],
    )

    const failure = await runMigrations(ownerDatabaseUrl()).catch((error: unknown) => error)

    expect(reasonOf(failure)).toContain('meter_cabinet')
    expect(await appliedMigrationCount(admin)).toBe(beforeTheChange)

    const { rows } = await admin.query<{ kind: string }>('select kind from distribution_boards')
    expect(rows.map((row) => row.kind)).toEqual(['meter_cabinet'])
  })
})

describe('the migration run', () => {
  it('refuses a migration that was changed after it had run', async () => {
    await olderInstallation()

    const changed = releaseFolder(olderRelease)
    changeMigration(
      changed,
      '0002_nummernkreise',
      'CREATE TABLE "smuggled" ("id" uuid PRIMARY KEY);',
    )

    const failure = await runMigrations(ownerDatabaseUrl(), changed).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(MigrationHistoryError)
    expect((failure as Error).message).toContain('0002_nummernkreise')

    // Without the refusal this would go through without a word: the runner
    // compares timestamps, finds nothing newer and does nothing. Whoever made
    // the change would take it for applied.
    expect(await tableNames(admin)).not.toContain('smuggled')
    expect(await appliedMigrationCount(admin)).toBe(olderRelease)
  })

  it('refuses to pass over a migration the runner would skip', async () => {
    await olderInstallation()

    const index = readMigrationIndex()
    const outOfOrder = releaseFolder(olderRelease, {
      tag: '0004_late_arrival',
      sql: 'CREATE TABLE "warranties" ("id" uuid PRIMARY KEY);',
      // Before the last one that has already run, which is what two branches
      // merged in the wrong order leave behind.
      when: (index[olderRelease - 1]?.when ?? 0) - 1000,
    })

    const failure = await runMigrations(ownerDatabaseUrl(), outOfOrder).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(MigrationHistoryError)
    expect((failure as Error).message).toContain('0004_late_arrival')

    // The table really is missing, so the migration really was skipped. The
    // check after the run is the only thing that says so.
    expect(await tableNames(admin)).not.toContain('warranties')
  })

  it('refuses an image that is older than the database', async () => {
    await resetSchema(admin)
    await runMigrations(ownerDatabaseUrl())

    const failure = await runMigrations(ownerDatabaseUrl(), releaseFolder(olderRelease)).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(MigrationHistoryError)
    expect((failure as Error).message).toContain('älter als die Datenbank')
  })
})

describe('the migrations in this repository', () => {
  const index = readMigrationIndex()

  it('have a rollback file each', () => {
    for (const migration of index) {
      const path = join(migrationsFolder, 'down', `${migration.tag}.sql`)

      expect(
        () => readFileSync(path, 'utf8'),
        `${migration.tag} has no rollback file`,
      ).not.toThrow()
    }
  })

  it('have timestamps that only ever increase', () => {
    // The runner compares against the newest applied migration and nothing
    // else. One arriving with an older timestamp is skipped, and the check
    // that catches it runs on somebody's installation. Here it costs a line.
    const timestamps = index.map((migration) => migration.when)

    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right))
    expect(new Set(timestamps).size).toBe(timestamps.length)
  })

  it('hold nothing that cannot run inside a transaction', () => {
    // Every pending migration shares one transaction, which is what leaves a
    // failed update on the state before it. CREATE INDEX CONCURRENTLY and
    // VACUUM refuse to run in one and would take that away.
    for (const migration of index) {
      const sql = readFileSync(join(migrationsFolder, `${migration.tag}.sql`), 'utf8')

      expect(sql, `${migration.tag} uses CONCURRENTLY`).not.toMatch(/\bconcurrently\b/i)
      expect(sql, `${migration.tag} uses VACUUM`).not.toMatch(/\bvacuum\b/i)
    }
  })
})
