import { ConfigurationError, Database } from '@opengewerk/platform-server'

import { createAuthentication } from './authentication/authentication.js'
import { readNewPassword } from './authentication/password.js'
import { accountExists } from './authentication/staff.js'
import { readConfiguration } from './configuration.js'
import { createTenantWithOwner } from './instance/tenants.js'

/**
 * Creates a further business on the instance from the command line (#142),
 * with its owner. The operators do the same in the area of the instance, where
 * the owner gets a link; here the owner is put in at once, with an account
 * when there is none yet, as `add-staff` does it.
 *
 * The password of a new account is asked for on the terminal and not shown,
 * or comes from `OPENGEWERK_PASSWORD`, never from an argument.
 *
 *     docker compose -f docker/compose.yaml exec app \
 *       node dist/add-tenant.js "<name des betriebs>" <e-mail> "<name des inhabers>"
 */
async function main(): Promise<void> {
  const [name, email, ownerName] = process.argv.slice(2)

  if (!name || !email || !ownerName) {
    throw new ConfigurationError(
      'Aufruf: add-tenant "<name des betriebs>" <e-mail> "<name des inhabers>"\n' +
        'Das Passwort eines neuen Kontos fragt der Befehl verdeckt ab; aus einem Skript heraus ' +
        'liest er es aus der Umgebungsvariable OPENGEWERK_PASSWORD. Ein Konto, das es schon ' +
        'gibt, behält sein Passwort.',
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

    const password = (await accountExists(database, email))
      ? null
      : await readNewPassword(process.env['OPENGEWERK_PASSWORD'], {
          input: process.stdin,
          output: process.stdout,
        })

    const authentication = createAuthentication({
      database,
      secret: configuration.sessionSecret,
      trustedOrigins: configuration.trustedOrigins,
    })

    const { tenantId, created } = await createTenantWithOwner(authentication, database, {
      name,
      ownerEmail: email,
      ownerName,
      password: password ?? '',
    })

    console.info(
      `Der Betrieb "${name.trim()}" ist angelegt, Kennung ${tenantId}. ` +
        (created
          ? `${email} ist dort Inhaber, mit einem neuen Konto.`
          : `${email} ist dort Inhaber; das Konto gab es schon, das Passwort ist unverändert.`),
    )
    console.info(
      'Für die Rolle "Inhaber" ist ein zweiter Faktor Pflicht. Die Anwendung fragt bei der ' +
        'ersten Anmeldung danach und richtet ihn ein.',
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
  } else if (error instanceof Error && 'status' in error) {
    console.error(error.message)
  } else {
    console.error('Der Betrieb konnte nicht angelegt werden.', error)
  }

  process.exitCode = 1
}
