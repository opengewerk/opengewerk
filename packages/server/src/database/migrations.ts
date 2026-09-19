import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

/**
 * Where the migration files live, relative to this file rather than to the
 * working directory. The built output keeps the same depth as the source, so
 * the one path works for both, and neither depends on where a container was
 * started from.
 */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

/**
 * Brings a database up to the current state.
 *
 * Runs as the role that owns the tables, never as the one the application
 * connects with: migrations create and alter, and the application role has
 * neither right. Keeping the two apart is what makes it impossible for a
 * mistake in a request to change the schema.
 *
 * Each migration runs in its own transaction. A failing one therefore leaves
 * the database at the last state that worked, with the reason in the log, and
 * an instance running the old image keeps working on it.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 })

  try {
    await migrate(drizzle(pool), { migrationsFolder })
  } finally {
    await pool.end()
  }
}
