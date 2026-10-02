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

// What stands between a request and a handler: who is asking, whether they
// may, where the request comes from, and what every answer carries. Which
// rights there are and who holds them, the application says.
export * from './api/authorization.js'
export * from './api/body.js'
export * from './api/client-address.js'
export * from './api/closed-identity.js'
export * from './api/handed-in.js'
export * from './api/identity.js'
export * from './api/origin.js'
export * from './api/security-headers.js'

// What is on the internet and what is inside a network.
export * from './network/internal-address.js'

// The authentication: accounts on the instance, memberships per tenant, and
// a session that works in one tenant at a time. Signing in with a password, a
// second factor and passkeys, the first run of an instance, the one time link
// somebody new comes in through, who works in a tenant and what they may do
// there, and the commands that are the way back. The application names
// itself, its roles and its words.
export * from './authentication/access.js'
export * from './authentication/administration.js'
export * from './authentication/authentication.controller.js'
export * from './authentication/authentication.js'
export * from './authentication/commands.js'
export * from './authentication/invitation.controller.js'
export * from './authentication/invitation.js'
export * from './authentication/invitation-mailing.js'
export * from './authentication/module.js'
export * from './authentication/notices.js'
export * from './authentication/passkeys.controller.js'
export * from './authentication/passkeys.js'
export * from './authentication/password.js'
export * from './authentication/reconfirmation.js'
export * from './authentication/recovery-codes.controller.js'
export * from './authentication/redemption.js'
export * from './authentication/roles.js'
export * from './authentication/session-identity.js'
export * from './authentication/session-lifetime.js'
export * from './authentication/setup-code.js'
export * from './authentication/setup.controller.js'
export * from './authentication/setup.js'
export * from './authentication/staff.controller.js'
export * from './authentication/staff.js'

// Addresses and host names as a mail server takes them.
export * from './mail/configuration.js'

// Web Push: encryption and signature, without a library.
export * from './push/web-push.js'
