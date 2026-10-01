import type { TenantId } from '@opengewerk/platform-domain'

import {
  ConfigurationError,
  type Environment,
  readConfiguration,
  type ServerApplication,
} from '../configuration.js'
import { Database } from '../database/database.js'
import type { AccessRules } from './access.js'
import { createAuthentication } from './authentication.js'
import { readNewPassword, type Terminal } from './password.js'
import { accountExists, addStaffMember, replacePassword } from './staff.js'

/**
 * The two commands that are the way back when the interface is no way in:
 * somebody has shut themselves out, a tenant sends no mail, or the machine
 * has no browser. An application starts each from a file of its own, with its
 * name and its rules; what they do is the same for every one of them.
 */

/** What a command is started with. Left out, it is what the process was given. */
export interface CommandSurroundings {
  /** What stands after the name of the command. */
  readonly arguments?: readonly string[]
  readonly environment?: Environment
  /** Where a password is asked for, and where the answer is not shown. */
  readonly terminal?: Terminal
  /** Where a command says what it did. The console, unless a test listens. */
  readonly say?: (line: string) => void
}

/** The surroundings of a command, with what the process was given where nothing else is said. */
function surroundingsOf(surroundings: CommandSurroundings): Required<CommandSurroundings> {
  return {
    arguments: surroundings.arguments ?? process.argv.slice(2),
    environment: surroundings.environment ?? process.env,
    terminal: surroundings.terminal ?? { input: process.stdin, output: process.stdout },
    say:
      surroundings.say ??
      ((line) => {
        console.info(line)
      }),
  }
}

/** The database of the instance, or the sentence saying why there is none to talk to. */
async function reach(databaseUrl: string): Promise<Database> {
  const database = Database.connect(databaseUrl)

  if (!(await database.isReachable())) {
    await database.close()

    throw new ConfigurationError(
      'Keine Verbindung zur Datenbank. Läuft PostgreSQL, und stimmen Adresse und ' +
        'Zugangsdaten in DATABASE_URL?',
    )
  }

  return database
}

/**
 * Runs a command and says what went wrong where it stops. A sentence that was
 * written for whoever reads the terminal is printed as it is; anything else
 * with what the command was about in front of it. A failure sets the exit
 * code and leaves the process to end on its own, so that what was written
 * reaches the terminal.
 */
async function run(work: () => Promise<void>, failure: string): Promise<void> {
  try {
    await work()
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message)
    } else {
      console.error(failure, error)
    }

    process.exitCode = 1
  }
}

/**
 * Puts a person into a tenant from the command line.
 *
 * Signing up is switched off. The first account of an instance comes from the
 * first run setup in the browser (#62), everybody after it from a link (#63).
 * This stays next to both as the way back when somebody has shut themselves
 * out, and as the only way on a machine without a browser.
 *
 * The password is asked for on the terminal and not shown, or comes from the
 * variable the application names in a script, and never as an argument: an
 * argument stands in the process list and in the shell history, where it is
 * read by anybody on the machine and kept for months. Nothing is made up and
 * printed (`readNewPassword`).
 *
 * Throws where the command stops, with the sentence for the terminal in a
 * `ConfigurationError`; `addStaffCommand` is the same with the ending of a
 * command around it.
 */
export async function addStaff(
  application: ServerApplication,
  access: AccessRules,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  const { arguments: given, environment, terminal, say } = surroundingsOf(surroundings)
  const [tenantId, email, name, ...roles] = given

  if (!tenantId || !email || !name || roles.length === 0) {
    throw new ConfigurationError(
      `${access.sentences.addStaff.usage}\n` +
        `Mögliche Rollen: ${access.roles.join(', ')}\n` +
        'Das Passwort fragt der Befehl verdeckt ab; aus einem Skript heraus liest er es aus ' +
        `der Umgebungsvariable ${application.passwordVariable}, nie aus einem Argument: ein ` +
        'Argument steht in der Prozessliste und im Verlauf der Shell.',
    )
  }

  const unknown = roles.filter((role) => !access.roles.includes(role))

  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Unbekannte Rolle: ${unknown.join(', ')}. Möglich sind: ${access.roles.join(', ')}`,
    )
  }

  const configuration = readConfiguration(application, environment)
  const database = await reach(configuration.databaseUrl)

  try {
    // An account that is already there keeps its password, so there is
    // nothing to ask for. Asking anyway would have somebody type a password
    // the command then throws away.
    const password = (await accountExists(database, email))
      ? null
      : await readNewPassword(
          environment[application.passwordVariable],
          terminal,
          application.passwordVariable,
        )

    const authentication = createAuthentication({
      application,
      access,
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
      roles,
    })

    say(
      created
        ? access.sentences.addStaff.added(email, tenantId, roles)
        : access.sentences.addStaff.kept(email, tenantId, roles),
    )

    if (access.requiresSecondFactor(roles)) {
      say(access.sentences.addStaff.secondFactor)
    }
  } finally {
    await database.close()
  }
}

/** The whole of the command an application starts as `add-staff`. */
export async function addStaffCommand(
  application: ServerApplication,
  access: AccessRules,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  await run(
    () => addStaff(application, access, surroundings),
    'Der Zugang konnte nicht angelegt werden.',
  )
}

/**
 * A new password for an account, from the command line (#126).
 *
 * The way back when no mail can bring a link: the tenant sends none, or the
 * one who forgot is the one who would have had to set it up. Every session of
 * the account ends, the second factor stays.
 *
 * The password is asked for on the terminal and not shown, or comes from the
 * variable the application names in a script, and never as an argument.
 * Nothing is printed that would let somebody sign in (`readNewPassword`).
 *
 * Throws where the command stops, like `addStaff`.
 */
export async function resetPassword(
  application: ServerApplication,
  access: Pick<AccessRules, 'sentences'>,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  const { arguments: given, environment, terminal, say } = surroundingsOf(surroundings)
  const [email] = given

  if (!email) {
    throw new ConfigurationError(
      'Aufruf: reset-password <e-mail>\n' +
        'Das neue Passwort fragt der Befehl verdeckt ab; aus einem Skript heraus liest er es ' +
        `aus der Umgebungsvariable ${application.passwordVariable}, nie aus einem Argument.`,
    )
  }

  const configuration = readConfiguration(application, environment)
  const database = await reach(configuration.databaseUrl)

  try {
    // Before the question, so that nobody types a password for an address
    // without an account behind it.
    if (!(await accountExists(database, email))) {
      throw new ConfigurationError(`Auf dieser Instanz gibt es keinen Zugang für ${email}.`)
    }

    const password = await readNewPassword(
      environment[application.passwordVariable],
      terminal,
      application.passwordVariable,
    )
    const authentication = createAuthentication({
      application,
      access,
      database,
      secret: configuration.sessionSecret,
      trustedOrigins: configuration.trustedOrigins,
    })

    if (!(await replacePassword(authentication, database, { email, password }))) {
      throw new ConfigurationError(`Auf dieser Instanz gibt es keinen Zugang für ${email}.`)
    }

    say(
      `Das Passwort von ${email} ist ersetzt, und alle Geräte dieses Zugangs sind abgemeldet. ` +
        'Ein eingerichteter zweiter Faktor gilt weiter.',
    )
  } finally {
    await database.close()
  }
}

/** The whole of the command an application starts as `reset-password`. */
export async function resetPasswordCommand(
  application: ServerApplication,
  access: Pick<AccessRules, 'sentences'>,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  await run(
    () => resetPassword(application, access, surroundings),
    'Das Passwort konnte nicht ersetzt werden.',
  )
}
