import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type MigrationFile,
  readMigrationIndex as readIndex,
  runMigrations as run,
} from '@opengewerk/platform-server'

// The runner is the foundation's (ADR 0010). The migrations are this
// application's own, and this file says where they are.

/**
 * Where the migration files live, relative to this file rather than to the
 * working directory. The built output keeps the same depth as the source, so
 * the one path works for both, and neither depends on where a container was
 * started from.
 */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

/** The journal and the files beside it, of this application unless a folder is named. */
export function readMigrationIndex(folder: string = migrationsFolder): MigrationFile[] {
  return readIndex(folder)
}

/**
 * Brings a database up to the state this image carries.
 *
 * The folder is a parameter so that a test can run an older state of it, which
 * is what an older image is. Operation never passes it.
 */
export async function runMigrations(
  connectionString: string,
  folder: string = migrationsFolder,
): Promise<void> {
  await run(connectionString, folder)
}
