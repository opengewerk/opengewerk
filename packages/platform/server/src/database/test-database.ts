import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Pool, type PoolClient } from 'pg'

import { catalogueDeviations, type OwnAdditions, readCatalogue } from './catalogue.js'
import type { MadeByTheApplication } from '../migration/guards.js'
import { foundationMigration } from './foundation-migration.js'
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

/**
 * The role the migrations run as, with its password. The role survives a
 * reset, the password has to be set either way. Only creating it when it is
 * missing looks the same until somebody changes the password here: CI starts
 * from an empty database and goes through, every local database still holds
 * the old one and every test fails at the connection. Setting it on both paths
 * costs one statement.
 */
async function giveOwnerRole(pool: Pool | PoolClient): Promise<void> {
  await pool.query(`do $$
    begin
      if not exists (select from pg_roles where rolname = '${ownerRole}') then
        create role "${ownerRole}" login password '${ownerPassword}' createrole;
      else
        alter role "${ownerRole}" login password '${ownerPassword}' createrole;
      end if;
    end
  $$`)
}

export async function allowApplicationLogin(pool: Pool | PoolClient): Promise<void> {
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
 * Waits until this many sessions stand in line for a row somebody else holds.
 *
 * For a test of a lock. Two requests sent off together reach the lock only
 * when chance has it: on a quicker machine one is through before the other
 * asks, both answers are right, and the lock was never what decided. A test
 * holds the row in a transaction of its own, waits here until both wait for
 * it, and lets go then.
 */
export async function standingInLine(pool: Pool, sessions: number): Promise<void> {
  const deadline = Date.now() + 10_000

  for (;;) {
    const { rows } = await pool.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    )

    if ((rows[0]?.waiting ?? 0) >= sessions) {
      return
    }

    if (Date.now() > deadline) {
      throw new Error(`Fewer than ${String(sessions)} sessions came to wait for the row.`)
    }

    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

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

/** One migration of a folder built for a test. */
export interface WrittenMigration {
  readonly tag: string
  readonly sql: string
  /** The timestamp in the journal. The runner orders by it. */
  readonly when: number
}

/**
 * A migrations folder as drizzle-kit would have written it: the files, and the
 * journal that names them in order. In the temporary directory; whoever asked
 * for it removes it again.
 */
export function writeMigrationsFolder(migrations: readonly WrittenMigration[]): string {
  const folder = mkdtempSync(join(tmpdir(), 'opengewerk-platform-migrations-'))
  mkdirSync(join(folder, 'meta'))

  for (const migration of migrations) {
    writeFileSync(join(folder, `${migration.tag}.sql`), migration.sql, 'utf8')
  }

  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify(
      {
        version: '7',
        dialect: 'postgresql',
        entries: migrations.map((migration, idx) => ({
          idx,
          version: '7',
          when: migration.when,
          tag: migration.tag,
          breakpoints: true,
        })),
      },
      null,
      2,
    ),
    'utf8',
  )

  return folder
}

/**
 * Raised when what goes into a template changes beyond the migrations, so
 * that no database keeps copying a template made the old way.
 */
const templateFormat = 1

/** What a template is called while it is being built. */
const buildingSuffix = '_building'

/** The name of the database an address points at. */
function nameOf(database: string): string {
  return new URL(database).pathname.replace(/^\//, '')
}

/** The same address, pointing at another database of the same server. */
function withName(database: string, name: string): string {
  const url = new URL(database)
  url.pathname = `/${name}`

  return url.toString()
}

/**
 * A short fingerprint of what the migration runner reads from a folder: the
 * journal and the file of every migration it names, with where the record of
 * them is kept. The snapshots drizzle-kit writes beside them are not read, and
 * not hashed either.
 */
export function migrationsFingerprint(folder: string, history?: MigrationHistory): string {
  const hash = createHash('sha256')
  const journal = readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')
  const { entries } = JSON.parse(journal) as { entries: { tag: string }[] }

  hash.update(`template format ${String(templateFormat)}\n${JSON.stringify(history ?? null)}\n`)
  hash.update(journal)

  for (const { tag } of entries) {
    hash.update(`\n${tag}\n`)
    hash.update(readFileSync(join(folder, `${tag}.sql`)))
  }

  return hash.digest('hex').slice(0, 12)
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
  /**
   * The tables of the foundation this application made with lists of its own.
   * They are built with the foundation and compared with it; left out, the
   * comparison would pass over them without a word.
   */
  readonly made?: MadeByTheApplication
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
   * Back to a freshly migrated database, the state `resetSchema`,
   * `applyMigrations` and `allowApplicationLogin` leave behind, in a fraction
   * of their time (#578): the database is dropped and made again as a copy of
   * a template the migrations ran into once, the first time it is asked for.
   * Whatever is connected to the database loses that connection; a pool opens
   * a new one on its next query, and one it has no listener for ends the test
   * run. A test of the migrations themselves keeps building them.
   */
  resetToMigrated(database?: string): Promise<void>
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
  /**
   * Builds the foundation alone in the database, from its building blocks, the
   * way the first migration of a new application does. Through the same
   * runner and as the same role as every migration.
   */
  applyFoundation(database?: string): Promise<void>
  /**
   * Where the database of this application departs from the building blocks
   * of the foundation: every table, key, policy, right, function and trigger
   * of the foundation has to be there exactly as a database built from the
   * blocks alone has it.
   *
   * Empties the database twice on the way, once for the blocks and once for
   * the migrations of the application, and leaves it migrated. Nothing listed
   * is the answer that is wanted. Something listed means a block is wrong, or
   * a migration changed the foundation without the block following: the
   * migration has run on somebody's installation, so it is the block that
   * moves.
   *
   * `own` names what the application has hung on tables of the foundation, a
   * trigger or an index of its own.
   */
  foundationDeviations(pool: Pool, own?: OwnAdditions): Promise<string[]>
}

export function testDatabase(options: TestDatabaseOptions): TestDatabase {
  const { migrationsFolder, defaultUrl, startHint, history, made } = options

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

    // `resetToMigrated` drops the database under the connections this pool
    // keeps open. The pool reports each as an event and opens a new one on the
    // next query; an event nobody listens to would end the test run.
    pool.on('error', () => undefined)

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

    await giveOwnerRole(pool)
    await pool.query(`grant create on database "${nameOf(database)}" to "${ownerRole}"`)
    await pool.query(`alter schema public owner to "${ownerRole}"`)
  }

  async function applyMigrations(database: string = testDatabaseUrl()): Promise<void> {
    await runMigrations(ownerDatabaseUrl(database), migrationsFolder, history)
  }

  /** A pool on the database every server has, to make and drop the others from. */
  async function onServer(database: string): Promise<Pool> {
    const server = new Pool({ connectionString: withName(database, 'postgres'), max: 1 })

    try {
      await server.query('select 1')
    } catch (cause) {
      await server.end()
      throw new Error(`No database to talk to. Start it with "${startHint}".`, { cause })
    }

    return server
  }

  /**
   * The template for the migrations as they are now. Named after the test
   * database and a fingerprint of what the migration runner reads, so that a
   * changed or added migration gets a template of its own and an old one is
   * never copied.
   */
  function templateName(database: string): string {
    const name = `${nameOf(database).replace(/_test$/, '')}_template_${migrationsFingerprint(migrationsFolder, history)}`

    if (name.length + buildingSuffix.length > 63) {
      throw new Error(
        `The template for the database "${nameOf(database)}" would be named "${name}", longer than PostgreSQL keeps a name.`,
      )
    }

    return name
  }

  /**
   * Builds the template once, the way `resetSchema`, `applyMigrations` and
   * `allowApplicationLogin` build a test database, unless it is there.
   *
   * One process at a time on the whole server, through a lock in the database
   * every connection here shares; the next finds the template made. It is
   * built under another name and renamed when it is whole, so that a run that
   * broke off halfway leaves nothing that gets copied.
   */
  async function migratedTemplate(server: Pool, database: string): Promise<string> {
    const template = templateName(database)
    const client = await server.connect()

    try {
      await client.query('select pg_advisory_lock(hashtext($1))', [template])

      const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
        template,
      ])

      if (rowCount === 0) {
        await dropStaleTemplates(client, database)

        const building = `${template}${buildingSuffix}`
        const url = withName(database, building)

        await client.query(`drop database if exists "${building}" with (force)`)
        await client.query(`create database "${building}"`)

        const pool = new Pool({ connectionString: url, max: 1 })

        try {
          await resetSchema(pool, url)
          await applyMigrations(url)
          await allowApplicationLogin(pool)
        } finally {
          await pool.end()
        }

        await client.query(`alter database "${building}" rename to "${template}"`)
        // Nobody connects to it, which is what copying it needs.
        await client.query(`alter database "${template}" with allow_connections false`)
        await client.query(`comment on database "${template}" is '${new Date().toISOString()}'`)
      }
    } finally {
      try {
        await client.query('select pg_advisory_unlock(hashtext($1))', [template])
      } finally {
        client.release()
      }
    }

    return template
  }

  /**
   * The templates of this test database that were made more than two days
   * ago: every changed migration leaves one behind on a database that keeps
   * running between test runs. One that is still in use is made again.
   */
  async function dropStaleTemplates(client: PoolClient, database: string): Promise<void> {
    const prefix = `${nameOf(database).replace(/_test$/, '')}_template_`
    const before = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const { rows } = await client.query<{ datname: string }>(
      `select datname from pg_database
        where left(datname, length($1)) = $1
          and right(datname, length($2)) <> $2
          and coalesce(shobj_description(oid, 'pg_database'), '') < $3`,
      [prefix, buildingSuffix, before],
    )

    for (const { datname } of rows) {
      await client.query(`drop database if exists "${datname}" with (force)`)
    }
  }

  async function resetToMigrated(database: string = testDatabaseUrl()): Promise<void> {
    const name = nameOf(database)
    const server = await onServer(database)

    try {
      const template = await migratedTemplate(server, database)

      await server.query(`drop database if exists "${name}" with (force)`)
      await server.query(`create database "${name}" template "${template}"`)
      // A copy takes what is in the template, not what was granted on the
      // template itself: the grant `resetSchema` gives the owner is given again.
      await server.query(`grant create on database "${name}" to "${ownerRole}"`)
      // The roles belong to the server and not to the copy. A test may have
      // changed one since the template was made, and `resetSchema` and
      // `allowApplicationLogin` set them every time, so this does too; under a
      // lock for the whole server, because a second test run on it, with a
      // database of its own, changes the same rows of the catalogue.
      const client = await server.connect()

      try {
        await client.query('begin')
        await client.query("select pg_advisory_xact_lock(hashtext('test kit roles'))")
        await giveOwnerRole(client)
        await allowApplicationLogin(client)
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    } finally {
      await server.end()
    }
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

  async function applyFoundation(database: string = testDatabaseUrl()): Promise<void> {
    const { up } = await foundationMigration(history, made)
    const folder = writeMigrationsFolder([{ tag: '0000_foundation', sql: up, when: 1 }])

    try {
      await runMigrations(ownerDatabaseUrl(database), folder, history)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }

  async function foundationDeviations(pool: Pool, own: OwnAdditions = {}): Promise<string[]> {
    await resetSchema(pool)
    await applyFoundation()
    const fromTheBlocks = await readCatalogue(pool)

    await resetSchema(pool)
    await applyMigrations()
    const fromTheMigrations = await readCatalogue(pool)

    return catalogueDeviations(fromTheBlocks, fromTheMigrations, own)
  }

  return {
    testDatabaseUrl,
    connect,
    ownerDatabaseUrl,
    applicationDatabaseUrl,
    resetSchema,
    applyMigrations,
    resetToMigrated,
    revertMigration,
    revertAllMigrations,
    migrationsFolderUpTo,
    applyFoundation,
    foundationDeviations,
  }
}
