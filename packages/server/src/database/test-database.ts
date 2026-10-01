import { testDatabase } from '@opengewerk/platform-server/testing'

import { migrationsFolder } from './migrations.js'

// The kit is the foundation's (ADR 0010): an empty database, the migrations
// run the way an installation runs them, and the two roles to look through.
// Bound here to this application, so that a test names one module for all of
// it.

export * from '@opengewerk/platform-server/testing'
export { migrationsFolder }

export const {
  testDatabaseUrl,
  connect,
  ownerDatabaseUrl,
  applicationDatabaseUrl,
  resetSchema,
  applyMigrations,
  revertMigration,
  revertAllMigrations,
  migrationsFolderUpTo,
  applyFoundation,
  foundationDeviations,
} = testDatabase({
  migrationsFolder,
  defaultUrl: 'postgres://opengewerk:opengewerk@127.0.0.1:5433/opengewerk_test',
  startHint: 'docker compose -f docker/compose.test.yaml up -d',
})
