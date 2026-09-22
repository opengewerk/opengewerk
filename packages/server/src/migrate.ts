import {
  ConfigurationError,
  migrationRole,
  parseConnectionString,
  refusePlaceholder,
} from './configuration.js'
import { MigrationHistoryError, runMigrations } from './database/migrations.js'

/**
 * Brings the database up to the current state, then exits.
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
async function main(): Promise<void> {
  const connectionString = process.env['MIGRATION_DATABASE_URL']?.trim()

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
  )

  await runMigrations(connectionString)

  console.info('Die Datenbank ist auf dem aktuellen Stand.')
}

try {
  await main()
} catch (error) {
  // Both carry a finished sentence and no stack worth printing: the one names
  // the variable that is missing, the other what the database and the image
  // disagree about. A stack under either would only bury it.
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
