import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

/**
 * The database the tests run against. These tests empty the schema before they
 * start, so the name has to end in `_test`: nobody is going to lose a
 * development database to a stray environment variable.
 */
export function testDatabaseUrl(): string {
  const url =
    process.env.DATABASE_URL ?? 'postgres://opengewerk:opengewerk@127.0.0.1:5433/opengewerk_test'
  const name = new URL(url).pathname.replace(/^\//, '')

  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run against the database "${name}": these tests drop the whole schema, ` +
        'so the name has to end in "_test". Start the test database with ' +
        '"docker compose -f docker/compose.test.yaml up -d".',
    )
  }

  return url
}

export async function connect(): Promise<Pool> {
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 4 })

  try {
    await pool.query('select 1')
  } catch (cause) {
    await pool.end()
    throw new Error(
      'No database to talk to. Start it with ' +
        '"docker compose -f docker/compose.test.yaml up -d".',
      { cause },
    )
  }

  return pool
}

/** Back to an empty database, the state a fresh installation starts from. */
export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query('drop schema if exists public cascade')
  await pool.query('drop schema if exists drizzle cascade')
  await pool.query('create schema public')
}

export async function applyMigrations(pool: Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder })
}

/**
 * Rolls a migration back. The file is split on the same marker drizzle-kit
 * writes into the forward migration, so both halves are read the same way.
 */
export async function revertMigration(pool: Pool, name: string): Promise<void> {
  const sql = readFileSync(join(migrationsFolder, 'down', `${name}.sql`), 'utf8')

  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed.length > 0) {
      await pool.query(trimmed)
    }
  }
}

/**
 * Rolls every applied migration back, newest first. Reads the journal that
 * drizzle-kit keeps, so a migration added later is included without anybody
 * remembering to. A migration without a file under `down/` makes this throw,
 * which is the point: that is the moment to notice, not the evening a rollback
 * is needed in production.
 */
export async function revertAllMigrations(pool: Pool): Promise<void> {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { idx: number; tag: string }[] }

  for (const entry of [...journal.entries].sort((left, right) => right.idx - left.idx)) {
    await revertMigration(pool, entry.tag)
  }
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
 * The role the application connects as. The migration creates it without a
 * password and without LOGIN, because credentials do not belong in a file that
 * sits in every clone of the repository. The tests give it both, for their own
 * throwaway database only.
 */
export const applicationRole = 'opengewerk_app'
const applicationPassword = 'nur-fuer-die-testdatenbank'

export async function allowApplicationLogin(pool: Pool): Promise<void> {
  await pool.query(`alter role "${applicationRole}" login password '${applicationPassword}'`)
}

/** The same database, seen through the role that row level security applies to. */
export function applicationDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl())
  url.username = applicationRole
  url.password = applicationPassword

  return url.toString()
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
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause

    return { code: cause?.code ?? 'unknown', constraint: cause?.constraint ?? 'unknown' }
  }

  throw new Error('The database accepted a write that it should have refused')
}

/** integrity_constraint_violation, check_violation. */
export const checkViolation = '23514'
/** integrity_constraint_violation, foreign_key_violation. */
export const foreignKeyViolation = '23503'
/** insufficient_privilege. What a row level security policy answers with. */
export const insufficientPrivilege = '42501'
