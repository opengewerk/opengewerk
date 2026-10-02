// The package is run, not imported: `main.ts` starts an instance and
// `migrate.ts` brings its database up to date. This file stays so the package
// has an entry point of its own, and so that a later consumer of the server
// has somewhere to import from.
export { ApiModule } from './api/api.module.js'
export { ClosedIdentitySource } from '@opengewerk/platform-server'
export { IDENTITY_SOURCE, type IdentitySource, type SignedInUser } from './api/identity.js'
export { type Authentication, authenticationPath } from '@opengewerk/platform-server'
export {
  addStaffMember,
  createAuthentication,
  SessionIdentitySource,
  type StaffMember,
} from './authentication/access.js'
export type { Configuration } from '@opengewerk/platform-server'
export { readConfiguration } from './configuration.js'
export { Database } from '@opengewerk/platform-server'
export { runMigrations } from './database/migrations.js'
export {
  readRendererConfiguration,
  renderPdf,
  RendererUnavailableError,
} from './documents/renderer.js'
