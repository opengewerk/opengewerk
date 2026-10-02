import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import {
  authenticationPath,
  ClosedIdentitySource,
  completeRoles,
  ConfigurationError,
  Database,
  instanceIsEmpty,
  readJsonBodiesOnly,
  sendSecurityHeaders,
  vapidKeysFrom,
} from '@opengewerk/platform-server'

import { toNodeHandler } from 'better-auth/node'

import { ApiModule } from './api/api.module.js'
import { access, createAuthentication, SessionIdentitySource } from './authentication/access.js'
import { readConfiguration } from './configuration.js'
import { readRendererConfiguration, rendererFor } from './documents/renderer.js'
import { DocumentFiles } from './api/document-files.js'
import { interfacePath, serveInterface } from './interface.js'
import { documentAttachments } from './mail/attachments.js'
import { invitationLinks } from './mail/invitation-link.js'
import { passkeyNotices } from './mail/passkey-notice.js'
import { passwordResetMails } from './mail/password-reset.js'
import { reachableOnly } from './mail/reach.js'
import { smtpTransport } from './mail/transport.js'
import { endInterruptedImports } from './datanorm/imports.js'
import { startDeadlineWorker } from './deadlines/engine.js'
import { startMailWorker } from './mail/worker.js'
import { httpsPost } from './push/post.js'
import { InstanceSettingsCache, takeOverFromEnvironment } from './instance/settings.js'
import { startPushWorker } from './push/worker.js'
import { SecretKey } from './secrets/key.js'
import { FileStore } from './storage/file-store.js'

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

  // The first trusted origin is the address the instance is reached at, the
  // one a link in a message has to point to.
  const origin = configuration.trustedOrigins[0] ?? ''

  // The settings of the instance (#188). MAIL_INTERNAL_HOSTS from the .env is
  // taken over once, so that an update switches off no mail server that
  // worked before it; after that its area decides. Kept in memory for the
  // check on every connection, and read again every half minute.
  if (await takeOverFromEnvironment(database, configuration.mailInternalHosts)) {
    console.log('MAIL_INTERNAL_HOSTS ist in die Einstellungen der Instanz übernommen.')
  }

  const instanceSettings = await InstanceSettingsCache.load(database)
  const stopInstanceSettings = instanceSettings.every(30_000)

  // Each business sets up its own mail server in the office, so there is
  // nothing to ask at startup: the key its password is sealed with is all the
  // instance brings. A closed instance sends nothing. It is closed for a
  // restore or a migration window, and a message out of a database that is
  // being put back is a message about a state that may not survive the hour.
  //
  // The connection reaches mail servers on the internet and the ones the
  // operators allow in the settings of the instance, nothing else in the
  // network the instance runs in; the check in the office and the job that
  // sends alike.
  const mail = configuration.closed
    ? null
    : {
        origin,
        key: SecretKey.from(configuration.sessionSecret),
        connect: reachableOnly(smtpTransport, {
          get internalHosts() {
            return instanceSettings.current().mailInternalHosts
          },
        }),
      }

  // Push to the devices of the people in a business (#284), where the .env
  // holds a key to sign with; without one the instance sends none and says so
  // under "Konto". The first trusted origin is who runs the instance, for the
  // operator of a push service. A closed instance sends nothing, as for mail.
  const push =
    !configuration.closed && configuration.vapidPrivateKey
      ? {
          vapid: vapidKeysFrom(configuration.vapidPrivateKey, origin),
          post: httpsPost(),
        }
      : null

  // After the mail, because the link to a new password goes out through the
  // mail server of a business (#126). A closed instance sends none.
  const authentication = createAuthentication({
    database,
    secret: configuration.sessionSecret,
    trustedOrigins: configuration.trustedOrigins,
    passwordResetMail: mail ? passwordResetMails(database, mail) : undefined,
    passkeyNotice: mail ? passkeyNotices(database, mail) : undefined,
  })

  const identities = configuration.closed
    ? new ClosedIdentitySource()
    : new SessionIdentitySource(authentication, database)

  // The file store and the renderer go in whether the instance is open or
  // closed. Closed, nothing reaches them, because every route that would is
  // behind the guard; open, they are what a PDF is printed with and kept in.
  // The trusted origins too: they open nothing, they only say which pages a
  // request that changes something may come from. And the record of the last
  // backup, which says when one ran and nothing else (#130).
  const output = {
    files: new FileStore(configuration.storagePath),
    renderer: rendererFor(readRendererConfiguration()),
    trustedOrigins: configuration.trustedOrigins,
    backupStatus: configuration.backupStatusPath,
    version: configuration.version,
  }

  const application = await NestFactory.create<NestExpressApplication>(
    // The authentication goes in only when the instance is open, and that is
    // what puts the first run setup on the routing table at all. Closed, the
    // controller is not registered and its two routes are simply not there.
    // The setup code goes with it, because only the first run asks for it.
    ApiModule.create(
      database,
      identities,
      configuration.closed
        ? output
        : {
            ...output,
            authentication,
            mail,
            push,
            setupCode: configuration.setupCode,
            instance: { settings: instanceSettings },
          },
    ),
    {
      // The container log is the only log there is, so it carries warnings
      // and errors and not the route table of every start. At twenty routes
      // that table is noise; at two hundred it buries the line that matters.
      logger: ['error', 'warn'],
      // No parser of Nest's own: `readJsonBodiesOnly` below sets the one that
      // is wanted, after better-auth.
      bodyParser: false,
    },
  )

  // First of all, so that every answer carries them, better-auth's included.
  sendSecurityHeaders(application.getHttpAdapter().getInstance())

  // Before the body parser, and that order is not a preference. Express reads
  // the stream once; a parser in front would leave better-auth with an empty
  // body on every sign in, and the failure looks like a wrong password.
  if (!configuration.closed) {
    application.use(authenticationPath, toNodeHandler(authentication))
  }

  readJsonBodiesOnly(application)

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
  let mailWorker: { readonly stop: () => Promise<void> } | null = null
  let deadlineWorker: { readonly stop: () => Promise<void> } | null = null
  let pushWorker: { readonly stop: () => Promise<void> } | null = null

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    console.info(`${signal} empfangen, OpenGewerk fährt herunter.`)

    try {
      // The mail job first. A pass that is running finishes, so that a
      // message is not sent and then forgotten because the pool closed
      // before the row could say so.
      await mailWorker?.stop()
      // The deadlines likewise: a reminder that has its mark gets its task.
      await deadlineWorker?.stop()
      // And push, whose pass writes down what became of each message.
      await pushWorker?.stop()
      stopInstanceSettings()
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

  // An import cut off by the last stop still says it runs, and would keep the
  // next out (#297). Ended before the first request, so that none started
  // after this start is ended with them. An instance whose database cannot
  // answer yet says so in the log and starts all the same.
  if (!configuration.closed) {
    await endInterruptedImports(database).catch((error: unknown) => {
      console.error('Unterbrochene Importe ließen sich nicht beenden.', error)
    })
  }

  // A business without a single role is one nobody can work in (ADR 0010).
  // The version from before the roles were rows goes on running between the
  // migration and this start, and a business it creates in that moment has
  // none. It gets the ones a business starts with here, before the first
  // request. Not on a closed instance, which writes nothing.
  if (!configuration.closed) {
    await completeRoles(database, access)
      .then((completed) => {
        for (const tenantId of completed) {
          console.info(
            `Der Betrieb ${tenantId} hatte keine Rollen und hat Inhaber, Büro und Monteur bekommen.`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('Die Rollen der Betriebe ließen sich nicht prüfen.', error)
      })
  }

  await application.listen(configuration.port, configuration.host)

  // The deadline engine runs on every instance that is open, with or without
  // a mail server: a reminder is a task first, and a message only where the
  // business can send one (#283).
  if (!configuration.closed) {
    deadlineWorker = startDeadlineWorker({ database })
  }

  if (push) {
    pushWorker = startPushWorker({ database, vapid: push.vapid, post: push.post })
  }

  if (mail) {
    mailWorker = startMailWorker({
      database,
      connect: mail.connect,
      key: mail.key,
      origin,
      // The same store and renderer the routes use, so that the file a
      // message carries is the file the document keeps.
      attachments: documentAttachments(new DocumentFiles(database, output.files, output.renderer)),
      invitationLinks: invitationLinks(database, origin),
    })
  }

  // Asked once at startup, because the answer decides what somebody sees when
  // they open the address for the first time. A fresh installation that says
  // nothing here looks in the log exactly like one that is set up, and the
  // sentence saves whoever put it there from wondering where the login went.
  //
  // A sentence in the log is never worth a server that does not start, so a
  // database that cannot answer simply gets no sentence. That is the case on
  // an instance whose migrations have not run.
  //
  // Where the setup code is, and never the code itself (#215): the log of a
  // container is read by more people and kept longer than the .env.
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
          'Betrieb und den ersten Zugang anlegt.' +
          (configuration.setupCode
            ? ' Sie verlangt den Einrichtungscode aus SETUP_CODE, in einer Installation ' +
              'mit Docker steht er in docker/.env.'
            : ' SETUP_CODE ist nicht gesetzt, deshalb nimmt sie keine Einrichtung an; ' +
              '"sh docker/start.sh" trägt den Einrichtungscode in docker/.env ein.')
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
