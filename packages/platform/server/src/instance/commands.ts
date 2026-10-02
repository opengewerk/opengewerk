import { HttpException } from '@nestjs/common'

import type { AccessRules } from '../authentication/access.js'
import { createAuthentication } from '../authentication/authentication.js'
import { readNewPassword } from '../authentication/password.js'
import { firstRoleOf } from '../authentication/roles.js'
import { accountExists } from '../authentication/staff.js'
import { type CommandSurroundings, reach, runCommand, surroundingsOf } from '../command-line.js'
import { ConfigurationError, readConfiguration, type ServerApplication } from '../configuration.js'
import { appointOperator } from './operators.js'
import { createTenantWithLead } from './tenants.js'

/**
 * The two commands of the area of the instance: naming somebody to run it,
 * and a further tenant with whoever leads it. Both are the way where the
 * interface is none: nobody runs the instance yet or everybody who does has
 * lost their second factor, or the machine has no browser. An application
 * starts each from a file of its own, with its name and its words.
 */

/**
 * A refusal the functions behind the routes wrote for a screen is a sentence
 * for the terminal just as well: no such account, already named, a name that
 * is none. Passed on as one, so that it is printed as it stands.
 */
async function withRefusalsAsSentences<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof HttpException) {
      throw new ConfigurationError(error.message)
    }

    throw error
  }
}

/**
 * Names an account to run the instance, from the command line (#188).
 *
 * The account of the first run setup is the first to run it. This is the way
 * where there is none, and the way back when every one of them has lost their
 * second factor. The account must exist already; its password stays as it is.
 *
 * Throws where the command stops, with the sentence for the terminal in a
 * `ConfigurationError`; `appointOperatorCommand` is the same with the ending
 * of a command around it.
 */
export async function appointOperatorFromCommandLine(
  application: ServerApplication,
  access: Pick<AccessRules, 'sentences'>,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  const { arguments: given, environment, say } = surroundingsOf(surroundings)
  const sentences = access.sentences.instance
  const [email] = given

  if (!email) {
    throw new ConfigurationError(sentences.appointOperator.usage)
  }

  const configuration = readConfiguration(application, environment)
  const database = await reach(configuration.databaseUrl)

  try {
    // Nobody is signed in at a shell, so the log of the instance names the
    // way and no person.
    const operator = await withRefusalsAsSentences(() =>
      appointOperator(database, sentences, '', email, 'operator.cli'),
    )

    say(sentences.appointOperator.appointed(operator.email))

    if (!operator.secondFactor) {
      say(sentences.appointOperator.secondFactor)
    }
  } finally {
    await database.close()
  }
}

/** The whole of the command an application starts as `appoint-operator`. */
export async function appointOperatorCommand(
  application: ServerApplication,
  access: Pick<AccessRules, 'sentences'>,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  await runCommand(
    () => appointOperatorFromCommandLine(application, access, surroundings),
    access.sentences.instance.appointOperator.failed,
  )
}

/**
 * Creates a further tenant on the instance from the command line (#142), with
 * whoever leads it. In the area of the instance the same is done with a link
 * for that person; here they are put in at once, with an account when there
 * is none yet, as `add-staff` does it.
 *
 * The password of a new account is asked for on the terminal and not shown,
 * or comes from the variable the application names in a script, and never
 * from an argument.
 *
 * Throws where the command stops, like the command above.
 */
export async function addTenant(
  application: ServerApplication,
  access: AccessRules,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  const { arguments: given, environment, terminal, say } = surroundingsOf(surroundings)
  const sentences = access.sentences.instance.addTenant
  const [name, email, leadName] = given

  if (!name || !email || !leadName) {
    throw new ConfigurationError(
      `${sentences.usage}\n` +
        'Das Passwort eines neuen Kontos fragt der Befehl verdeckt ab; aus einem Skript heraus ' +
        `liest er es aus der Umgebungsvariable ${application.passwordVariable}. Ein Konto, das ` +
        'es schon gibt, behält sein Passwort.',
    )
  }

  const configuration = readConfiguration(application, environment)
  const database = await reach(configuration.databaseUrl)

  try {
    // An account that is already there keeps its password, so there is
    // nothing to ask for.
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

    const { tenantId, created } = await withRefusalsAsSentences(() =>
      createTenantWithLead(authentication, database, access, {
        name,
        leadEmail: email,
        leadName,
        password: password ?? '',
      }),
    )

    say(
      created
        ? sentences.createdWithAccount(name.trim(), tenantId, email)
        : sentences.createdForAccount(name.trim(), tenantId, email),
    )

    if (firstRoleOf(access).secondFactor) {
      say(sentences.secondFactor)
    }
  } finally {
    await database.close()
  }
}

/** The whole of the command an application starts as `add-tenant`. */
export async function addTenantCommand(
  application: ServerApplication,
  access: AccessRules,
  surroundings: CommandSurroundings = {},
): Promise<void> {
  await runCommand(
    () => addTenant(application, access, surroundings),
    access.sentences.instance.addTenant.failed,
  )
}
