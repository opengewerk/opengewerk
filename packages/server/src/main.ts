import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { toNodeHandler } from 'better-auth/node'

import { ApiModule } from './api/api.module.js'
import { ClosedIdentitySource } from './api/closed-identity.js'
import { authenticationPath, createAuthentication } from './authentication/authentication.js'
import { SessionIdentitySource } from './authentication/session-identity.js'
import { ConfigurationError, readConfiguration } from './configuration.js'
import { Database } from './database/database.js'

/**
 * Starts an instance.
 *
 * The identity source is better-auth's, unless `CLOSED` is set, in which case
 * it is the one that recognises nobody: the instance runs, migrates, reports
 * its health and hands out no data at all. That is what an operator wants
 * during a restore, and it is the state this server shipped in until the
 * authentication existed.
 *
 * better-auth's own routes are mounted as middleware, in front of Nest and
 * outside the guard. They have to be: a route that hands out a session cannot
 * ask for one, and the guard refuses everything that declares no right. What
 * protects them instead is their own layer, the rate limits and the origin
 * check from `createAuthentication`. Everything after signing in, the choice
 * of business included, is an ordinary route behind the guard.
 *
 * Migrations do not run from here. They run as a different role, before this
 * process starts, which is what keeps the application from ever connecting
 * with rights it must not have. `migrate.ts` is that step.
 */
async function start(): Promise<void> {
  const configuration = readConfiguration()
  const database = Database.connect(configuration.databaseUrl)

  if (!(await database.isReachable())) {
    await database.close()

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

  const identities = configuration.closed
    ? new ClosedIdentitySource()
    : new SessionIdentitySource(authentication, database)

  const application = await NestFactory.create(
    ApiModule.create(database, identities),
    // The container log is the only log there is, so it carries warnings and
    // errors and not the route table of every start. At twenty routes that
    // table is noise; at two hundred it buries the line that matters.
    { logger: ['error', 'warn'] },
  )

  // Before Nest's own body parser, and that order is not a preference. Express
  // reads the stream once; a parser in front would leave better-auth with an
  // empty body on every sign in, and the failure looks like a wrong password.
  if (!configuration.closed) {
    application.use(authenticationPath, toNodeHandler(authentication))
  }

  // Nothing is gained by telling every caller which framework serves them,
  // and a scanner looking for a known weakness is told where to look.
  application.getHttpAdapter().getInstance().disable('x-powered-by')

  // A container gets SIGTERM and then, a moment later, SIGKILL. Closing in
  // between lets running transactions commit instead of being cut off, which
  // matters most during an update: that is when a restart is most likely to
  // land in the middle of somebody issuing an invoice.
  //
  // The order is the point. The server stops taking requests first, then the
  // pool closes; the other way round the requests still in flight would lose
  // their connection.
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    console.info(`${signal} empfangen, OpenGewerk fährt herunter.`)

    try {
      await application.close()
      await database.close()
    } catch (error) {
      console.error('Beim Herunterfahren ist etwas schiefgegangen.', error)
      process.exitCode = 1
    }
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, (received: NodeJS.Signals) => {
      void stop(received)
    })
  }

  await application.listen(configuration.port, configuration.host)

  console.info(
    `OpenGewerk lauscht auf ${configuration.host}:${configuration.port}.` +
      (configuration.closed
        ? ' Die Instanz ist über CLOSED geschlossen, jede Anfrage an die Daten wird ' +
          'abgelehnt, auch die Anmeldung.'
        : ''),
  )
}

try {
  await start()
} catch (error) {
  // A configuration mistake gets the sentence and nothing else. A stack trace
  // above "DATABASE_URL fehlt" buries the one line that says what to do.
  if (error instanceof ConfigurationError) {
    console.error(error.message)
  } else {
    console.error('OpenGewerk konnte nicht starten.', error)
  }

  process.exitCode = 1
}
