import {
  ConfigurationError,
  type Environment,
  parseConnectionString,
  refusePlaceholder,
  type ServerApplication,
} from '../configuration.js'
import {
  defaultMigrationHistory,
  type MigrationHistory,
  MigrationHistoryError,
  runMigrations,
} from './migrations.js'
import { migrationRole } from './roles.js'

/**
 * Brings the database up to the state the application's migrations describe.
 *
 * Its own command and its own container step, run before the application
 * starts. Two reasons, and the second is the one that matters:
 *
 * 1. It connects as the owner of the tables, the application as a role with
 *    no right to create or alter anything. A server that migrated on startup
 *    would have to hold owner credentials for the whole time it runs.
 * 2. Several application containers behind a proxy would otherwise migrate
 *    the same database at the same time on the same update.
 *
 * Running it against a database that is already current does nothing, which
 * is what lets it sit in front of every start rather than only updates.
 */
async function migrateFrom(
  application: ServerApplication,
  folder: string,
  environment: Environment,
  history: MigrationHistory,
): Promise<void> {
  const connectionString = environment['MIGRATION_DATABASE_URL']?.trim()

  if (!connectionString) {
    throw new ConfigurationError(
      'Die Umgebungsvariable MIGRATION_DATABASE_URL fehlt. Sie zeigt auf dieselbe ' +
        `Datenbank wie DATABASE_URL, meldet sich aber als "${migrationRole}" an, also ` +
        'als die Rolle, der die Tabellen gehören.',
    )
  }

  // Checked here and not only in the driver, because the driver's answer to a
  // broken address is a name lookup that failed for a host nobody meant.
  parseConnectionString(
    refusePlaceholder(connectionString, 'MIGRATION_DATABASE_URL'),
    'MIGRATION_DATABASE_URL',
    application.exampleDatabase,
  )

  await runMigrations(connectionString, folder, history)

  console.info('Die Datenbank ist auf dem aktuellen Stand.')
}

/**
 * The whole of the command an application starts as `migrate`: the run, and
 * what the log says when it stops. The application names itself and its
 * folder; a failure sets the exit code and leaves the process to end on its
 * own, so that what was written reaches the log.
 */
export async function migrateCommand(
  application: ServerApplication,
  folder: string,
  environment: Environment = process.env,
  history: MigrationHistory = defaultMigrationHistory,
): Promise<void> {
  try {
    await migrateFrom(application, folder, environment, history)
  } catch (error) {
    // Both carry a finished sentence and no stack worth printing: the one
    // names the variable that is missing, the other what the database and the
    // image disagree about. A stack under either would only bury it.
    if (error instanceof ConfigurationError || error instanceof MigrationHistoryError) {
      console.error(error.message)
    } else {
      // The reason belongs in the log in full. Somebody reads this during an
      // update that has just stopped, and "migration failed" without the
      // statement that failed sends them looking through six files.
      console.error(
        'Die Migration ist fehlgeschlagen. Die Datenbank steht unverändert auf dem Stand ' +
          'davor, es wurde nichts halb eingespielt. Grund:',
      )
      console.error(error)
    }

    process.exitCode = 1
  }
}
