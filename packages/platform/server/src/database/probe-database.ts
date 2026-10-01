import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MigrationHistory } from './migrations.js'
import { type TestDatabase, testDatabase } from './test-database.js'

// What the tests of the foundation's own database code run against: the test
// database of the repository the foundation lives in, and migrations that are
// written for the test. The foundation brings no migrations of its own (every
// application has its own stream, ADR 0010), so a folder is built per test.

/** One migration of a folder built for a test. */
export interface ProbeMigration {
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
export function probeMigrations(migrations: readonly ProbeMigration[]): string {
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

/** The kit, bound to a folder of the test and to the test database of this repository. */
export function probeDatabase(migrationsFolder: string, history?: MigrationHistory): TestDatabase {
  return testDatabase({
    migrationsFolder,
    defaultUrl: 'postgres://opengewerk:opengewerk@127.0.0.1:5433/opengewerk_test',
    startHint: 'docker compose -f docker/compose.test.yaml up -d',
    ...(history ? { history } : {}),
  })
}
