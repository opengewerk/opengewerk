import type { RoleKey, TenantId } from '@opengewerk/domain'
import { roleKeys } from '@opengewerk/domain'

import { createAuthentication } from './authentication/authentication.js'
import { generatePassword, shortestPassword } from './authentication/password.js'
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

  const given = process.env['OPENGEWERK_PASSWORD']?.trim()

  if (given !== undefined && given.length < shortestPassword) {
    // Only when one was given. A password that is there and too short is a
    // mistake worth stopping for; none at all is the case below.
    throw new ConfigurationError(
      `OPENGEWERK_PASSWORD ist kürzer als ${String(shortestPassword)} Zeichen. Kurze ` +
        'Passwörter sind genau bei der ' +
        'Anmeldung die teure Stelle, weil sie einmal gesetzt und jahrelang benutzt werden. ' +
        'Wer keines zur Hand hat, lässt die Variable weg: dann wird eines erzeugt.',
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

    const { created } = await addStaffMember(authentication, database, {
      email,
      name,
      password,
      tenantId: tenantId as TenantId,
      roles: roles as RoleKey[],
    })

    console.info(
      created
        ? `${email} ist im Betrieb ${tenantId} angelegt, Rollen: ${roles.join(', ')}.`
        : `${email} gab es schon auf dieser Instanz. Die Rollen im Betrieb ${tenantId} ` +
            `stehen jetzt auf: ${roles.join(', ')}. Das Passwort ist unverändert.`,
    )

    if (created && given === undefined) {
      // Once, on standard output, and nowhere else. This command runs under
      // `docker compose exec`, so what it prints goes to the terminal of
      // whoever ran it and not into the log of the container, and the log is
      // what somebody hands over when they ask for help.
      console.info(`Erzeugtes Passwort: ${password}`)
      console.info(
        'Es steht nur hier und nirgends sonst. Beim ersten Anmelden gehört es ersetzt, ' +
          'denn bis dahin kennt es jeder, der diese Zeile gesehen hat.',
      )
    }

    if (roles.includes('owner')) {
      console.info(
        'Für die Rolle "Inhaber" ist ein zweiter Faktor Pflicht. Die Anwendung fragt bei der ' +
          'ersten Anmeldung danach und richtet ihn ein.',
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
