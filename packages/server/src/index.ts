// The package is run, not imported: `main.ts` starts an instance and
// `migrate.ts` brings its database up to date. This file stays so the package
// has an entry point of its own, and so that a later consumer of the server
// has somewhere to import from.
export { ApiModule } from './api/api.module.js'
export { ClosedIdentitySource } from './api/closed-identity.js'
export { IDENTITY_SOURCE, type IdentitySource, type SignedInUser } from './api/identity.js'
export {
  type Authentication,
  authenticationPath,
  createAuthentication,
} from './authentication/authentication.js'
export { SessionIdentitySource } from './authentication/session-identity.js'
export { addStaffMember, type StaffMember } from './authentication/staff.js'
export { readConfiguration, type Configuration } from './configuration.js'
export { Database } from './database/database.js'
export { runMigrations } from './database/migrations.js'
export {
  readRendererConfiguration,
  renderPdf,
  RendererUnavailableError,
} from './documents/renderer.js'
