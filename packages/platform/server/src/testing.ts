// What the tests of an application stand on, as an entry of its own:
// `@opengewerk/platform-server/testing`. Nothing a running instance needs is
// in here, and nothing in here is part of what a running instance loads.

// An empty database, the migrations run the way an installation runs them,
// and the two roles to look through.
export * from './database/test-database.js'

// The database described by its own catalogue, and the foundation built from
// its building blocks alone, to hold the first against the second.
export * from './database/catalogue.js'
export * from './database/foundation-migration.js'

// The questions about the separation of tenants every application asks of
// its own catalogue.
export * from './database/tenant-checks.js'

// An identity out of a header, and the routes of a module with what each of
// them asks of whoever calls it.
export * from './api/routes.js'
export * from './api/test-identity.js'

// Whether the sealed credentials of an application are touched in one
// place only.
export * from './secrets/boundaries.js'

// What somebody holds in their hand when they sign in: the app that shows a
// code, and a device with a passkey.
export * from './authentication/test-authenticator.js'
