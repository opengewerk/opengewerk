import {
  type AccessCheck,
  type Configuration,
  directoryIsWritable,
  type Environment,
  readConfiguration as read,
  type ServerApplication,
} from '@opengewerk/platform-server'

/**
 * What this application calls itself, where the foundation has to say a name.
 *
 * The sentences an instance writes into its log, the port it listens on and
 * the variable its version arrives in are the application's own; the checks
 * around them are the foundation's and the same for every application of the
 * organisation (ADR 0010, point 10).
 */
export const application: ServerApplication = {
  name: 'OpenGewerk',
  // Far above the 3000 that most machines that develop anything have taken
  // already, and below the range Linux hands out for outgoing connections.
  port: 23700,
  versionVariable: 'OPENGEWERK_VERSION',
  passwordVariable: 'OPENGEWERK_PASSWORD',
  exampleOrigin: 'https://opengewerk.example.de',
  exampleDatabase: 'opengewerk',
}

/** What an instance of this application needs to know, read and checked by the foundation. */
export function readConfiguration(
  environment: Environment = process.env,
  checkAccess: AccessCheck = directoryIsWritable,
): Configuration {
  return read(application, environment, checkAccess)
}
