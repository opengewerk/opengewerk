import type { RoleKey, TenantId } from '@opengewerk/domain'
import { roleKeys } from '@opengewerk/domain'

import { createAuthentication } from './authentication/authentication.js'
import { addStaffMember } from './authentication/staff.js'
import { ConfigurationError, readConfiguration } from './configuration.js'
import { Database } from './database/database.js'

/**
 * Puts a person into a business from the command line, and the only way an
 * account comes into being at all.
 *
 * Signing up is switched off, so without this a freshly installed instance
 * would start, migrate, answer its health check and have no way in. There is
 * no screen for staff yet; when there is, this stays, because the first owner
 * of an instance has to be created before anybody can log in to create one.
 *
 * The password is read from `OPENGEWERK_PASSWORD` rather than taken as an
 * argument. An argument stands in the process list and in the shell history,
 * where it is read by anybody on the machine and kept for months.
 *
 *     OPENGEWERK_PASSWORD='...' pnpm --filter @opengewerk/server exec \
 *       node dist/add-staff.js <tenant-id> <email> <name> owner
 */
async function main(): Promise<void> {
  const [tenantId, email, name, ...roles] = process.argv.slice(2)

  if (!tenantId || !email || !name || roles.length === 0) {
    throw new ConfigurationError(
      'Aufruf: add-staff <betriebs-id> <e-mail> "<name>" <rolle> [<rolle> ...]\n' +
        `Mögliche Rollen: ${roleKeys.join(', ')}\n` +
        'Das Passwort wird aus der Umgebungsvariable OPENGEWERK_PASSWORD gelesen, nicht ' +
        'als Argument übergeben: ein Argument steht in der Prozessliste und im Verlauf der ' +
        'Shell.',
    )
  }

  const unknown = roles.filter((role) => !roleKeys.includes(role as RoleKey))

  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unbekannte Rolle: ${unknown.join(', ')}. Möglich sind: ${roleKeys.join(', ')}`,
    )
  }

  const password = process.env['OPENGEWERK_PASSWORD']?.trim()

  if (!password || password.length < 12) {
    throw new ConfigurationError(
      'OPENGEWERK_PASSWORD fehlt oder ist kürzer als 12 Zeichen. Kurze Passwörter sind ' +
        'genau bei der Anmeldung die teure Stelle, weil sie einmal gesetzt und jahrelang ' +
        'benutzt werden.',
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

    const authentication = createAuthentication({
      database,
      secret: configuration.sessionSecret,
      trustedOrigins: configuration.trustedOrigins,
    })

    await addStaffMember(authentication, database, {
      email,
      name,
      password,
      tenantId: tenantId as TenantId,
      roles: roles as RoleKey[],
    })

    console.info(`${email} ist im Betrieb ${tenantId} angelegt, Rollen: ${roles.join(', ')}.`)

    if (roles.includes('owner')) {
      console.info(
        'Für die Rolle "Inhaber" ist ein zweiter Faktor Pflicht. Bis er eingerichtet ist, ' +
          'kommt diese Anmeldung bis zur Betriebswahl und nicht weiter.',
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
    console.error('Der Zugang konnte nicht angelegt werden.', error)
  }

  process.exitCode = 1
}
