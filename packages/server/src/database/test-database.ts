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
