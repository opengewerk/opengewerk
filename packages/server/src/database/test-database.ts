import { shippedRoles } from '@opengewerk/domain'
import { testDatabase } from '@opengewerk/platform-server/testing'

import { migrationsFolder } from './migrations.js'
import { madeWithLists } from './schema/made.js'

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
  resetToMigrated,
  revertMigration,
  revertAllMigrations,
  migrationsFolderUpTo,
  applyFoundation,
  foundationDeviations,
} = testDatabase({
  migrationsFolder,
  defaultUrl: 'postgres://opengewerk:opengewerk@127.0.0.1:5433/opengewerk_test',
  startHint: 'docker compose -f docker/compose.test.yaml up -d',
  // The tables of the foundation with the lists of this application, so that
  // the comparison with the building blocks covers them too.
  made: madeWithLists,
})

/** Something a statement can be sent through: a pool, or one connection of it. */
interface Statements {
  query(text: string, values?: unknown[]): Promise<unknown>
}

/**
 * Gives businesses that were written by hand the roles a business starts
 * with, as the first run and the area of the instance write them (ADR 0010).
 *
 * A test that inserts the row of a business and nothing else has one in which
 * nobody holds a right: what somebody may do is read from these rows. Only a
 * test that signs somebody in or hands out roles notices; one that names its
 * people in a header gets their rights from the roles in the code.
 *
 * Sent as whoever set the connection up, which in a test is the superuser.
 * The application writes the same rows through `writeRoles`, inside the
 * business; the tests of the first run and of further businesses go that way.
 */
export async function shipRoles(through: Statements, ...tenantIds: string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    for (const role of shippedRoles) {
      await through.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }
}
