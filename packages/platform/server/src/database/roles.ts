// The two roles of the database, by name. They are called the same in every
// application of the organisation (ADR 0010, point 10): each application has a
// PostgreSQL of its own, and roles only meet inside one cluster.

import { applicationRoleName, migrationRoleName } from '@opengewerk/platform-domain'

/** The role that owns the tables and runs the migrations. */
export const migrationRole = migrationRoleName

/**
 * The role the application connects as, the one the policies are written for.
 * Named in the foundation without I/O, because the change log tells a change
 * that came through it from one that did not, on the screen as well.
 */
export { applicationRoleName }
