import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { toNodeHandler } from 'better-auth/node'

import { ApiModule } from './api/api.module.js'
import { ClosedIdentitySource } from './api/closed-identity.js'
import { authenticationPath, createAuthentication } from './authentication/authentication.js'
import { SessionIdentitySource } from './authentication/session-identity.js'
import { instanceIsEmpty } from './authentication/setup.js'
import { ConfigurationError, readConfiguration } from './configuration.js'
import { Database } from './database/database.js'
import { interfacePath, serveInterface } from './interface.js'

/**
 * Starts an instance.
 *
 * The identity source is better-auth's, unless `CLOSED` is set, in which case
 * it is the one that recognises nobody: the instance runs, migrates, reports
 * its health and hands out no data at all, the sign in and the first run setup
 * included. That is what an operator wants during a restore, and it is the
 * state this server shipped in until the authentication existed.
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
    // The authentication goes in only when the instance is open, and that is
    // what puts the first run setup on the routing table at all. Closed, the
    // controller is not registered and its two routes are simply not there.
    ApiModule.create(
      database,
      identities,
      configuration.closed ? {} : { authentication, trustedOrigins: configuration.trustedOrigins },
    ),
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

  // The interface, from the same process. Mounted after Nest's routes, so a
  // path the API owns is answered by the API; the fallback inside knows the
  // same list and refuses to hand a shell to anything under it.
  //
  // Absent during development, where vite serves the two entry points itself
  // and proxies the API here. Saying so out loud beats a silent 404 at the
  // root that reads like a broken install.
  const built = interfacePath()

  if (built) {
    serveInterface(application.getHttpAdapter().getInstance(), built)
  }

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

  // Asked once at startup, because the answer decides what somebody sees when
  // they open the address for the first time. A fresh installation that says
  // nothing here looks in the log exactly like one that is set up, and the
  // sentence saves whoever put it there from wondering where the login went.
  //
  // A sentence in the log is never worth a server that does not start, so a
  // database that cannot answer simply gets no sentence. That is the case on
  // an instance whose migrations have not run.
  const empty = configuration.closed ? false : await instanceIsEmpty(database).catch(() => false)

  console.info(
    `OpenGewerk lauscht auf ${configuration.host}:${configuration.port}.` +
      (built ? '' : ' Es ist keine gebaute Oberfläche dabei, nur die API.') +
      (configuration.closed
        ? ' Die Instanz ist über CLOSED geschlossen, jede Anfrage an die Daten wird ' +
          'abgelehnt, die Anmeldung und die Ersteinrichtung eingeschlossen.'
        : '') +
      (empty
        ? ' Diese Instanz ist noch leer: im Browser steht die Ersteinrichtung, die den ' +
          'Betrieb und den ersten Zugang anlegt.'
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
