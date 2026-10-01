// The server side of the foundation (ADR 0010): what every application of the
// organisation needs between a request and the database, and nothing that only
// one of them knows. No customer and no document, no property and no
// obligation. Where a mechanism here needs a list or a word that belongs to an
// application, the application hands it in.

// What an instance reads from its environment, checked before anything
// connects. The application names itself.
export * from './configuration.js'

// The way to the data: one transaction per tenant, with the tenant set before
// anything else happens, and a second one for what belongs to the instance.
export * from './database/database.js'
export * from './database/every-tenant.js'
export * from './database/identifier.js'
export * from './database/roles.js'

// The migration runner. The migrations are the application's own.
export * from './database/migrate-command.js'
export * from './database/migrations.js'

// References between the records of one tenant, read off the foreign keys.
export * from './database/references.js'

// The building blocks a schema is put together from: the columns every table
// has, and the policies that keep tenants apart.
export * from './database/schema/columns.js'
export * from './database/schema/rls.js'

// What a refusal of the database becomes on its way to the caller.
export * from './api/database-errors.js'

// The code the first run of an instance asks for.
export * from './authentication/setup-code.js'

// Addresses and host names as a mail server takes them.
export * from './mail/configuration.js'

// Web Push: encryption and signature, without a library.
export * from './push/web-push.js'
