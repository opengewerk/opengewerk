import { createAuthentication } from './authentication/authentication.js'
import { readNewPassword } from './authentication/password.js'
import { accountExists, replacePassword } from './authentication/staff.js'
import { ConfigurationError, readConfiguration } from './configuration.js'
import { Database } from './database/database.js'

/**
 * A new password for an account, from the command line (#126).
 *
 * The way back when no mail can bring a link: the business sends none, or the
 * one who forgot is the owner who would have had to set it up. Every session
 * of the account ends, the second factor stays.
 *
 * The password is asked for on the terminal and not shown, or comes from
 * `OPENGEWERK_PASSWORD` in a script, and never as an argument: an argument
 * stands in the process list and in the shell history. Nothing is printed
 * that would let somebody sign in (`readNewPassword`).
 *
 *     docker compose -f docker/compose.yaml exec app node dist/reset-password.js <email>
 */
async function main(): Promise<void> {
  const [email] = process.argv.slice(2)

  if (!email) {
    throw new ConfigurationError(
      'Aufruf: reset-password <e-mail>\n' +
        'Das neue Passwort fragt der Befehl verdeckt ab; aus einem Skript heraus liest er es ' +
        'aus der Umgebungsvariable OPENGEWERK_PASSWORD, nie aus einem Argument.',
    )
  }

  const configuration = readConfiguration()
  const database = Database.connect(configuration.databaseUrl)

  try {
    if (!(await database.isReachable())) {
      throw new ConfigurationError(
        'Keine Verbindung zur Datenbank. Läuft PostgreSQL, und stimmen Adresse und ' +
          'Zugangsdaten in DATABASE_URL?',
      )
    }

    // Before the question, so that nobody types a password for an address
    // without an account behind it.
    if (!(await accountExists(database, email))) {
      throw new ConfigurationError(`Auf dieser Instanz gibt es keinen Zugang für ${email}.`)
    }

    const password = await readNewPassword(process.env['OPENGEWERK_PASSWORD'], {
      input: process.stdin,
      output: process.stdout,
    })
    const authentication = createAuthentication({
      database,
      secret: configuration.sessionSecret,
      trustedOrigins: configuration.trustedOrigins,
    })

    if (!(await replacePassword(authentication, database, { email, password }))) {
      throw new ConfigurationError(`Auf dieser Instanz gibt es keinen Zugang für ${email}.`)
    }

    console.info(
      `Das Passwort von ${email} ist ersetzt, und alle Geräte dieses Zugangs sind abgemeldet. ` +
        'Ein eingerichteter zweiter Faktor gilt weiter.',
    )
  } finally {
    await database.close()
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(error.message)
  } else {
    console.error('Das Passwort konnte nicht ersetzt werden.', error)
  }

  process.exitCode = 1
}
