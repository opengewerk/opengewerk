// The tables every application of the organisation carries, as an entry of
// its own: `@opengewerk/platform-server/schema`. Tenants, accounts and
// sessions, memberships and invitations, the roles of a tenant, the audit log
// and the sync layer.
//
// An application hands this on from the file drizzle-kit reads its schema
// from and builds its own tables next to it. Nothing but tables, enums and the
// role is exported here, so that file stays a schema and nothing else.
//
// What drizzle-kit cannot write for these tables (the role, the grants, FORCE,
// the functions and the triggers) is under `sql/`, see `./migration.ts`.
export { applicationRole } from './database/schema/rls.js'

export * from './database/schema/audit.js'
export * from './database/schema/authentication.js'
export * from './database/schema/memberships.js'
export * from './database/schema/sync.js'
export * from './database/schema/tenant-roles.js'
export * from './database/schema/tenants.js'
