import type { MigrationHistory } from './migrations.js'
import {
  type TestDatabase,
  testDatabase,
  type WrittenMigration,
  writeMigrationsFolder,
} from './test-database.js'

// What the tests of the foundation's own database code run against: the test
// database of the repository the foundation lives in, and migrations that are
// written for the test. The foundation brings no migrations of its own (every
// application has its own stream, ADR 0010), so a folder is built per test.

/** One migration of a folder built for a test. */
export type ProbeMigration = WrittenMigration

/**
 * A migrations folder as drizzle-kit would have written it. In the temporary
 * directory; whoever asked for it removes it again.
 */
export function probeMigrations(migrations: readonly ProbeMigration[]): string {
  return writeMigrationsFolder(migrations)
}

/** The kit, bound to a folder of the test and to the test database of this repository. */
export function probeDatabase(migrationsFolder: string, history?: MigrationHistory): TestDatabase {
  return testDatabase({
    migrationsFolder,
    defaultUrl: 'postgres://opengewerk:opengewerk@127.0.0.1:5433/opengewerk_test',
    startHint: 'docker compose -f docker/compose.test.yaml up -d',
    ...(history ? { history } : {}),
  })
}
