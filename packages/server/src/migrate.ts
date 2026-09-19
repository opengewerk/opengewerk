import { ConfigurationError, migrationRole, parseConnectionString } from './configuration.js'
import { runMigrations } from './database/migrations.js'

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
  parseConnectionString(connectionString, 'MIGRATION_DATABASE_URL')

  await runMigrations(connectionString)

  console.info('Die Datenbank ist auf dem aktuellen Stand.')
}

try {
  await main()
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(error.message)
  } else {
    // The reason belongs in the log in full. Somebody reads this during an
    // update that has just stopped, and "migration failed" without the
    // statement that failed sends them looking through six files.
    console.error(
      'Die Migration ist fehlgeschlagen. Die Datenbank steht auf dem Stand davor, und ' +
        'eine Instanz mit dem alten Abbild läuft darauf weiter. Grund:',
    )
    console.error(error)
  }

  process.exitCode = 1
}
