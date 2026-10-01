import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Pool } from 'pg'

import { type MigrationHistory, runMigrations } from './migrations.js'
import { applicationRoleName, migrationRole } from './roles.js'

// The kit the tests of an application stand on: an empty database, the
// application's migrations run the way an installation runs them, and the two
// roles to look through. It is part of the foundation because what it guards
// is: a test that migrates as a superuser checks none of the policies, and
// that mistake is made once per application unless the kit rules it out.
//
// Everything that needs to know an application takes it from `testDatabase`
// below. What needs nothing is exported as it is.

/**
 * The role the migrations run as, and the one that ends up owning the tables.
 *
 * It is deliberately not a superuser, and that is the whole reason it exists.
 * Row level security never applies to a superuser, so a schema created by one
 * would let every policy pass untested, including the ones that only matter
 * for the owner: `FORCE`, and the pair of policies the audit trigger writes
 * through. Those would then be exercised for the first time on somebody's
 * installation.
 *
 * `createrole` because the first migration creates the application role.
 */
export const ownerRole = migrationRole
const ownerPassword = 'nur-für-die-testdatenbank'

/**
 * The role the application connects as. The migration creates it without a
 * password and without LOGIN, because credentials do not belong in a file that
 * sits in every clone of the repository. The tests give it both, for their own
 * throwaway database only.
 */
export const applicationRole = applicationRoleName
const applicationPassword = 'nur-für-die-testdatenbank'

export async function allowApplicationLogin(pool: Pool): Promise<void> {
  await pool.query(`alter role "${applicationRole}" login password '${applicationPassword}'`)
}

export async function tableNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  )

  return result.rows.map((row) => row.table_name)
}

export async function enumNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ typname: string }>(
    `select t.typname from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where t.typtype = 'e' and n.nspname = 'public'
      order by t.typname`,
  )

  return result.rows.map((row) => row.typname)
}

/**
 * Every enum type in `public` with its values, in the order PostgreSQL keeps
 * them. `enumsortorder` rather than the name: the order is part of the type,
 * it decides what `order by` on such a column does, and `ALTER TYPE ... ADD
 * VALUE BEFORE` exists precisely to place a value inside it.
 */
export async function enumValues(pool: Pool): Promise<Map<string, string[]>> {
  const result = await pool.query<{ typname: string; label: string }>(
    `select t.typname, e.enumlabel as label from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       join pg_enum e on e.enumtypid = t.oid
      where t.typtype = 'e' and n.nspname = 'public'
      order by t.typname, e.enumsortorder`,
  )

  const values = new Map<string, string[]>()

  for (const row of result.rows) {
    values.set(row.typname, [...(values.get(row.typname) ?? []), row.label])
  }

  return values
}

/**
 * The functions the migrations left behind, for the same check as the tables.
 *
 * Extensions are excluded through `pg_depend`, otherwise `uuidv7` comes along
 * and the round trip could never end at an empty list. A `CREATE FUNCTION`
 * without `OR REPLACE` makes a forgotten rollback more than something left
 * behind: the next run forward fails with "function already exists", and
 * going forward again is what the down files are for.
 */
export async function functionNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ proname: string }>(
    `select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (
          select 1 from pg_depend d
           where d.objid = p.oid and d.deptype = 'e'
        )
      order by p.proname`,
  )

  return result.rows.map((row) => row.proname)
}

/**
 * Runs a write that the database has to refuse, and says why it refused.
 * Drizzle wraps the driver error in one that only repeats the query, so the
 * code and the constraint name have to be read from the cause. Checking both
 * matters: a test that only asserts "it threw" would still pass if the row
 * were rejected for an entirely different reason, such as a typo in a column.
 */
export async function refusedBy(
  write: Promise<unknown>,
): Promise<{ code: string; constraint: string }> {
  try {
    await write
  } catch (error) {
    // Drizzle wraps the driver error and keeps the original as the cause; a
    // query sent straight through the pool carries the fields itself.
    for (const candidate of [error, (error as { cause?: unknown }).cause]) {
      const code = (candidate as { code?: unknown } | undefined)?.code

      if (typeof code === 'string') {
        const constraint = (candidate as { constraint?: unknown }).constraint

        return { code, constraint: typeof constraint === 'string' ? constraint : 'unknown' }
      }
    }

    return { code: 'unknown', constraint: 'unknown' }
  }

  throw new Error('The database accepted a write that it should have refused')
}

/** integrity_constraint_violation, check_violation. */
export const checkViolation = '23514'
/** integrity_constraint_violation, foreign_key_violation. */
export const foreignKeyViolation = '23503'
/** insufficient_privilege. What a row level security policy answers with. */
export const insufficientPrivilege = '42501'

/**
 * A migration that does not exist in the repository, for a test that needs one
 * to fail or to arrive out of order.
 */
export interface AddedMigration {
  readonly tag: string
  readonly sql: string
  /**
   * The timestamp in the journal. Left out it lands after the last real one,
   * which is where a new migration belongs.
   */
  readonly when?: number
}

/**
 * Changes a migration in a folder built by `migrationsFolderUpTo`, the way
 * somebody would who corrects a merged migration instead of writing a new one.
 */
export function changeMigration(folder: string, tag: string, addition: string): void {
  const path = join(folder, `${tag}.sql`)

  writeFileSync(path, `${readFileSync(path, 'utf8')}\n${addition}\n`, 'utf8')
}

/** How many migrations the database says have run. */
export async function appliedMigrationCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'select count(*) as count from drizzle.__drizzle_migrations',
  )

  return Number(rows[0]?.count ?? 0)
}

export async function columnNames(pool: Pool, table: string): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [table],
  )

  return result.rows.map((row) => row.column_name)
}

/** What a test kit has to be told about the application it is for. */
export interface TestDatabaseOptions {
  /** The migrations of the application, the folder its image carries. */
  readonly migrationsFolder: string
  /**
   * Where the test database is when `DATABASE_URL` does not say. The name of
   * the database has to end in `_test`, as every address the kit takes.
   */
  readonly defaultUrl: string
  /** How to start that database, for the sentence a missing one is met with. */
  readonly startHint: string
  /** Where the application's migration runner keeps its record, if not the default. */
  readonly history?: MigrationHistory
}

/** The helpers that need to know the application, bound to it. */
export interface TestDatabase {
  /**
   * The database the tests run against. These tests empty the schema before
   * they start, so the name has to end in `_test`: nobody is going to lose a
   * development database to a stray environment variable.
   *
   * The helpers below take another address as well, for the one other
   * throwaway database there is: a preview, which checks its own name the same
   * way before it gets anywhere near them.
   */
  testDatabaseUrl(): string
  connect(): Promise<Pool>
  /** The same database, seen through the role that owns the tables. */
  ownerDatabaseUrl(database?: string): string
  /** The same database, seen through the role that row level security applies to. */
  applicationDatabaseUrl(database?: string): string
  /** Back to an empty database, the state a fresh installation starts from. */
  resetSchema(pool: Pool, database?: string): Promise<void>
  /** Runs the migrations the way an installation does, as the owner. */
  applyMigrations(database?: string): Promise<void>
  /**
   * Rolls a migration back. The file is split on the same marker drizzle-kit
   * writes into the forward migration, so both halves are read the same way.
   */
  revertMigration(pool: Pool, name: string): Promise<void>
  /**
   * Rolls every applied migration back, newest first. Reads the journal that
   * drizzle-kit keeps, so a migration added later is included without anybody
   * remembering to. A migration without a file under `down/` makes this throw,
   * which is the point: that is the moment to notice, not the evening a
   * rollback is needed in production.
   */
  revertAllMigrations(pool: Pool): Promise<void>
  /**
   * Builds the migrations folder as an older release carried it: the first
   * `count` migrations and a journal that ends there.
   *
   * This is what makes an update testable without a second image. An older
   * version differs from this one in exactly this respect, it brings fewer
   * migration files, and a database migrated from such a folder stands on the
   * state that release left behind.
   *
   * Returns the path to a folder in the temporary directory. Whoever asked
   * for it removes it again.
   */
  migrationsFolderUpTo(count: number, ...added: AddedMigration[]): string
}

export function testDatabase(options: TestDatabaseOptions): TestDatabase {
  const { migrationsFolder, defaultUrl, startHint, history } = options

  function testDatabaseUrl(): string {
    const url = process.env['DATABASE_URL'] ?? defaultUrl
    const name = new URL(url).pathname.replace(/^\//, '')

    if (!name.endsWith('_test')) {
      throw new Error(
        `Refusing to run against the database "${name}": these tests drop the whole schema, ` +
          `so the name has to end in "_test". Start the test database with "${startHint}".`,
      )
    }

    return url
  }

  async function connect(): Promise<Pool> {
    const pool = new Pool({ connectionString: testDatabaseUrl(), max: 4 })

    try {
      await pool.query('select 1')
    } catch (cause) {
      await pool.end()
      throw new Error(`No database to talk to. Start it with "${startHint}".`, { cause })
    }

    return pool
  }

  function ownerDatabaseUrl(database: string = testDatabaseUrl()): string {
    const url = new URL(database)
    url.username = ownerRole
    url.password = ownerPassword

    return url.toString()
  }

  function applicationDatabaseUrl(database: string = testDatabaseUrl()): string {
    const url = new URL(database)
    url.username = applicationRole
    url.password = applicationPassword

    return url.toString()
  }

  async function resetSchema(pool: Pool, database: string = testDatabaseUrl()): Promise<void> {
    await pool.query('drop schema if exists public cascade')
    await pool.query('drop schema if exists drizzle cascade')

    if (history && history.schema !== 'drizzle' && history.schema !== 'public') {
      await pool.query(`drop schema if exists "${history.schema}" cascade`)
    }

    await pool.query('create schema public')

    // The role survives a reset, the password has to be set either way. Only
    // creating it when it is missing looks the same until somebody changes the
    // password here: CI starts from an empty database and goes through, every
    // local database still holds the old one and every test fails at the
    // connection. Setting it on both paths costs one statement.
    await pool.query(`do $$
      begin
        if not exists (select from pg_roles where rolname = '${ownerRole}') then
          create role "${ownerRole}" login password '${ownerPassword}' createrole;
        else
          alter role "${ownerRole}" login password '${ownerPassword}' createrole;
        end if;
      end
    $$`)

    const name = new URL(database).pathname.replace(/^\//, '')
    await pool.query(`grant create on database "${name}" to "${ownerRole}"`)
    await pool.query(`alter schema public owner to "${ownerRole}"`)
  }

  async function applyMigrations(database: string = testDatabaseUrl()): Promise<void> {
    await runMigrations(ownerDatabaseUrl(database), migrationsFolder, history)
  }

  async function revertMigration(pool: Pool, name: string): Promise<void> {
    const sql = readFileSync(join(migrationsFolder, 'down', `${name}.sql`), 'utf8')

    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed.length > 0) {
        await pool.query(trimmed)
      }
    }
  }

  async function revertAllMigrations(pool: Pool): Promise<void> {
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] }

    for (const entry of [...journal.entries].sort((left, right) => right.idx - left.idx)) {
      await revertMigration(pool, entry.tag)
    }
  }

  function migrationsFolderUpTo(count: number, ...added: AddedMigration[]): string {
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as {
      version: string
      dialect: string
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[]
    }

    const entries = [...journal.entries].sort((left, right) => left.idx - right.idx).slice(0, count)

    if (entries.length < count) {
      throw new Error(`Asked for ${count} migrations, the repository has ${journal.entries.length}`)
    }

    const folder = mkdtempSync(join(tmpdir(), 'opengewerk-migrations-'))
    mkdirSync(join(folder, 'meta'))

    for (const entry of entries) {
      copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
    }

    const last = entries.at(-1)

    for (const [position, migration] of added.entries()) {
      writeFileSync(join(folder, `${migration.tag}.sql`), migration.sql, 'utf8')
      entries.push({
        idx: entries.length,
        version: journal.version,
        when: migration.when ?? (last?.when ?? 0) + 1000 * (position + 1),
        tag: migration.tag,
        breakpoints: true,
      })
    }

    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ version: journal.version, dialect: journal.dialect, entries }, null, 2),
      'utf8',
    )

    return folder
  }

  return {
    testDatabaseUrl,
    connect,
    ownerDatabaseUrl,
    applicationDatabaseUrl,
    resetSchema,
    applyMigrations,
    revertMigration,
    revertAllMigrations,
    migrationsFolderUpTo,
  }
}
