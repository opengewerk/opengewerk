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

// Tables of the foundation an application makes with a list of its own: the
// columns and the rules are the same everywhere, what the list holds is not.
// The outbox of the mail, the deadlines, the contacts and the files in the
// records of a tenant take columns of the application as well.
export * from './database/schema/attachments.js'
export * from './database/schema/contacts.js'
export * from './database/schema/labels.js'
export * from './database/schema/deadlines.js'
export * from './database/schema/mail-outbox.js'
export * from './database/schema/number-ranges.js'
export * from './database/schema/push.js'
export * from './database/schema/parameters.js'
export * from './database/schema/secrets.js'

// What a tenant sets for itself, with the day it applies from. Which settings
// there are, the application says.
export * from './database/parameters.js'

// Numbers that run without holes, drawn inside the transaction that needs
// one. Which sequences there are, and which year a moment falls in, the
// application says.
export * from './database/number-ranges.js'

// The sync on the server: applying what a device queued up, recording what
// became of it, the pull by change sequence, and the routes a device sends
// and fetches through. Which entities travel, under which rules, what is
// asked of an operation before the database does, which right it needs and
// what a device holds, the application says.
export * from './sync/apply.js'
export * from './sync/controller.js'
export * from './sync/narrowing.js'
export * from './sync/record-rules.js'
export * from './sync/tables.js'

// The change log of a tenant as a person reads it: a page of changes with the
// names it needs, the parts of one record, the check of the chain and the
// routes for them. What a table, a field and a reason are called the
// application says, in its vocabulary.
export * from './audit/chain.js'
export * from './audit/controller.js'
export * from './audit/log.js'

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
export * from './api/health.controller.js'
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

// The area of the instance: who runs it, its settings, its log, the tenants on
// it and the ways a further one comes to be. What whoever runs it and a tenant
// are called, the application says.
export * from './instance/access.js'
export * from './instance/commands.js'
export * from './instance/instance.controller.js'
export * from './instance/log.js'
export * from './instance/operators.js'
export * from './instance/sentences.js'
export * from './instance/settings.js'
export * from './instance/tenants.js'

// The files a tenant keeps: the content addressed store, the row that makes a
// file a tenant's, what its first bytes show, and the route its bytes are
// stored through. Who may store one, the application says.
export * from './files/controller.js'
export * from './files/media-type.js'
export * from './files/rows.js'
export * from './files/store.js'

// The people to talk to at the records of an application: the routes they
// are listed, added, corrected and taken away through, and what the sync asks
// of one. What a contact hangs on and who may keep one, the application says.
export * from './contacts/controller.js'
export * from './contacts/sync.js'

// The files in the records of an application, with their versions: the routes
// a version is handed out through, and what the sync asks of a file and of a
// version. What a file hangs on and who may read one, the application says.
export * from './attachments/controller.js'
export * from './attachments/sync.js'

// When the last backup of the instance ran, and the route that says so. Who
// may see it, the application says.
export * from './backup/controller.js'
export * from './backup/status.js'

// Printing: the renderer service that turns a page into a PDF, the token a
// module hands it in under, and what every printed page is written with. What
// a page says, the application writes.
export * from './print/characters.js'
export * from './print/helpers.js'
export * from './print/renderer.js'

// Labels with a QR code: drawing the code of a new one, and the page they are
// printed on, for a label printer or a sheet. What a label hangs on and what
// its three lines say, the application says.
export * from './labels/code.js'
export * from './print/label.js'

// What a command is started with, for a test that listens to one.
export type { CommandSurroundings } from './command-line.js'

// Credentials of somebody else a tenant hands the instance: the seal, and the
// one place the sealed values are kept and opened. The purposes are the
// application's.
export * from './secrets/key.js'
export * from './secrets/store.js'

// Mail: addresses and host names as a mail server takes them, the one
// transport, where a mail server may be and how it is asked, the mail server
// of a tenant and the routes of its settings, the outbox with its retries,
// the link of an invitation made as it goes out, and the job that sends. Who
// may see and change the settings, what a signature may say, which causes
// there are and what a message about one says, the application says.
export * from './mail/check.js'
export * from './mail/configuration.js'
export * from './mail/context.js'
export * from './mail/invitation-link.js'
export * from './mail/outbox.js'
export * from './mail/reach.js'
export * from './mail/server-settings.js'
export * from './mail/settings.controller.js'
export * from './mail/transport.js'
export * from './mail/worker.js'

// The mechanism that turns an occasion of an application into a message for
// mail and for push: one table of occasions, and both jobs run over it.
export * from './deadlines/deadlines.controller.js'
export * from './deadlines/engine.js'
export * from './deadlines/responsible.js'
export * from './deadlines/runs.js'
export * from './deadlines/settings.js'
export * from './notifications/occasions.js'

// Web Push: encryption and signature without a library, the rule for the
// address of a push service, the devices and the outbox of a tenant, the job
// that sends and the routes of push. Which entries and occasions there are,
// and what a message says, the application says.
export * from './push/context.js'
export * from './push/deliver.js'
export * from './push/outbox.js'
export * from './push/post.js'
export * from './push/push.controller.js'
export * from './push/web-push.js'
export * from './push/worker.js'

// The way in of an instance: the built interface served from the same process
// as the API, with a shell for every address that is neither a file nor the
// server's.
export * from './start/lifecycle.js'
export * from './start/repeat.js'
export * from './start/server.js'
export * from './start/shells.js'
