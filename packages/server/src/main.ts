import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { ApiModule } from './api/api.module.js'
import { ClosedIdentitySource } from './api/closed-identity.js'
import { ConfigurationError, readConfiguration } from './configuration.js'
import { Database } from './database/database.js'

/**
 * Starts an instance.
 *
 * The identity source is the one that recognises nobody. Every route behind
 * the guard therefore answers 401, and that is the honest state of things
 * until the authentication exists: the instance runs, migrates, reports its
 * health and hands out no data at all. Swapping in a real source is the only
 * change this file needs when that work lands.
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

  const application = await NestFactory.create(
    ApiModule.create(database, new ClosedIdentitySource()),
    // The container log is the only log there is, so it carries warnings and
    // errors and not the route table of every start. At twenty routes that
    // table is noise; at two hundred it buries the line that matters.
    { logger: ['error', 'warn'] },
  )

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
    `OpenGewerk lauscht auf ${configuration.host}:${configuration.port}. ` +
      'Es ist keine Anmeldung eingerichtet, jede Anfrage an die Daten wird abgelehnt.',
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
