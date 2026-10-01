import { ConfigurationError, Database } from '@opengewerk/platform-server'

import { readConfiguration } from './configuration.js'
import { appointOperator } from './instance/operators.js'

/**
 * Names an operator of the instance from the command line (#188).
 *
 * The account of the first run setup is the first operator, and on an
 * instance set up before there were operators, migration 0051 finds that
 * account in the log of the first business. This is the way where it finds
 * none, and the way back when every operator has lost their second factor.
 * The account must exist already; its password stays as it is.
 *
 *     docker compose -f docker/compose.yaml exec app \
 *       node dist/appoint-operator.js <email>
 */
async function main(): Promise<void> {
  const [email] = process.argv.slice(2)

  if (!email) {
    throw new ConfigurationError(
      'Aufruf: appoint-operator <e-mail>\n' +
        'Das Konto muss es auf dieser Instanz schon geben. Es wird Betreiber und erreicht ' +
        'den Bereich der Instanz, sobald ein zweiter Faktor eingerichtet ist.',
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

    const operator = await appointOperator(database, '', email, 'operator.cli')

    console.info(`${operator.email} ist jetzt Betreiber dieser Instanz.`)

    if (!operator.secondFactor) {
      console.info(
        'Für den Bereich der Instanz ist ein zweiter Faktor Pflicht, eine Authenticator-App ' +
          'oder ein Passkey. Beides wird unter „Konto“ eingerichtet; bis dahin bleibt der ' +
          'Bereich zu.',
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
  } else if (error instanceof Error && 'status' in error) {
    // The refusals of the route: no such account, already an operator.
    console.error(error.message)
  } else {
    console.error('Der Betreiber konnte nicht benannt werden.', error)
  }

  process.exitCode = 1
}
