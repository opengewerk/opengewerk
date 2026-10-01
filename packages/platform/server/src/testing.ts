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
