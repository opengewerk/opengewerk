import type { RoleKey, TenantId } from '@opengewerk/domain'
import { roleKeys } from '@opengewerk/domain'

import { createAuthentication } from './authentication/authentication.js'
import { readNewPassword } from './authentication/password.js'
import { accountExists, addStaffMember } from './authentication/staff.js'
import { ConfigurationError, readConfiguration } from './configuration.js'
import { Database } from './database/database.js'

/**
 * Puts a person into a business from the command line.
 *
 * Signing up is switched off. The first owner of an instance comes from the
 * first run setup in the browser (#62), everybody after them from a link the
 * office sends (#63). This stays next to both as the way back when somebody
 * has shut themselves out, and as the only way on a machine without a browser.
 *
 * The password is asked for on the terminal and not shown, or comes from
 * `OPENGEWERK_PASSWORD` in a script, and never as an argument: an argument
 * stands in the process list and in the shell history, where it is read by
 * anybody on the machine and kept for months. Nothing is made up and printed
 * (`readNewPassword`).
 *
 *     docker compose -f docker/compose.yaml exec app \
 *       node dist/add-staff.js <tenant-id> <email> <name> owner
 */
async function main(): Promise<void> {
  const [tenantId, email, name, ...roles] = process.argv.slice(2)

  if (!tenantId || !email || !name || roles.length === 0) {
    throw new ConfigurationError(
      'Aufruf: add-staff <betriebs-id> <e-mail> "<name>" <rolle> [<rolle> ...]\n' +
        `Mögliche Rollen: ${roleKeys.join(', ')}\n` +
        'Das Passwort fragt der Befehl verdeckt ab; aus einem Skript heraus liest er es aus ' +
        'der Umgebungsvariable OPENGEWERK_PASSWORD, nie aus einem Argument: ein Argument ' +
        'steht in der Prozessliste und im Verlauf der Shell.',
    )
  }

  const unknown = roles.filter((role) => !roleKeys.includes(role as RoleKey))

  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unbekannte Rolle: ${unknown.join(', ')}. Möglich sind: ${roleKeys.join(', ')}`,
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

    // An account that is already there keeps its password, so there is
    // nothing to ask for. Asking anyway would have somebody type a password
    // the command then throws away.
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

    const { created } = await addStaffMember(authentication, database, {
      email,
      name,
      // Ignored for an account that is already there, as with a redeemed
      // invitation: `createAccount` returns before the empty string reaches
      // a hasher, and an account is never deleted.
      password: password ?? '',
      tenantId: tenantId as TenantId,
      roles: roles as RoleKey[],
    })

    console.info(
      created
        ? `${email} ist im Betrieb ${tenantId} angelegt, Rollen: ${roles.join(', ')}.`
        : `${email} gab es schon auf dieser Instanz. Die Rollen im Betrieb ${tenantId} ` +
            `stehen jetzt auf: ${roles.join(', ')}. Das Passwort ist unverändert.`,
    )

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
