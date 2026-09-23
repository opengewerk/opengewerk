import { createAuthentication } from './authentication/authentication.js'
import { generatePassword, shortestPassword } from './authentication/password.js'
import { replacePassword } from './authentication/staff.js'
import { ConfigurationError, readConfiguration } from './configuration.js'
import { Database } from './database/database.js'

/**
 * A new password for an account, from the command line (#126).
 *
 * The way back when no mail can bring a link: the business sends none, or the
 * one who forgot is the owner who would have had to set it up. Every session
 * of the account ends, the second factor stays.
 *
 * The password comes from `OPENGEWERK_PASSWORD`, or is made here and printed
 * once, like with `add-staff`, and never as an argument: an argument stands in
 * the process list and in the shell history.
 *
 *     docker compose -f docker/compose.yaml exec app node dist/reset-password.js <email>
 */
async function main(): Promise<void> {
  const [email] = process.argv.slice(2)

  if (!email) {
    throw new ConfigurationError(
      'Aufruf: reset-password <e-mail>\n' +
        'Das neue Passwort wird aus der Umgebungsvariable OPENGEWERK_PASSWORD gelesen oder ' +
        'erzeugt und einmal ausgegeben, nie als Argument übergeben.',
    )
  }

  const given = process.env['OPENGEWERK_PASSWORD']?.trim()

  if (given !== undefined && given.length < shortestPassword) {
    throw new ConfigurationError(
      `OPENGEWERK_PASSWORD ist kürzer als ${String(shortestPassword)} Zeichen. Wer keines zur ` +
        'Hand hat, lässt die Variable weg: dann wird eines erzeugt.',
    )
  }

  const password = given ?? generatePassword()
  const configuration = readConfiguration()
  const database = Database.connect(configuration.databaseUrl)

  try {
    if (!(await database.isReachable())) {
      throw new ConfigurationError(
        'Keine Verbindung zur Datenbank. Läuft PostgreSQL, und stimmen Adresse und ' +
          'Zugangsdaten in DATABASE_URL?',
      )
    }

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

    if (given === undefined) {
      // Once, on standard output, and nowhere else, like `add-staff`.
      console.info(`Neues Passwort: ${password}`)
      console.info(
        'Es steht nur hier. Nach dem Anmelden gehört es unter "Konto" ersetzt, denn bis dahin ' +
          'kennt es jeder, der diese Zeile gesehen hat.',
      )
    }
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
