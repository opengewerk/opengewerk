import 'reflect-metadata'

import { serverPaths } from '@opengewerk/domain'
import {
  authenticationHandler,
  ClosedIdentitySource,
  completeRoles,
  ConfigurationError,
  createServer,
  Database,
  instanceIsEmpty,
  InstanceSettingsCache,
  runInstance,
  SecretKey,
  startupLine,
  stopOnSignals,
  takeOverFromEnvironment,
  vapidKeysFrom,
} from '@opengewerk/platform-server'

import { ApiModule } from './api/api.module.js'
import { access, createAuthentication, SessionIdentitySource } from './authentication/access.js'
import { application as opengewerk, readConfiguration } from './configuration.js'
import { readRendererConfiguration, rendererFor } from './documents/renderer.js'
import { DocumentFiles } from './api/document-files.js'
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
import { startPushWorker } from './push/worker.js'
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

  // The authentication goes in only when the instance is open, and that is
  // what puts the first run setup on the routing table at all. Closed, the
  // controller is not registered and its two routes are simply not there.
  // The setup code goes with it, because only the first run asks for it.
  //
  // What stands in front of the routes, in its order, and the interface from
  // the same process, are the foundation's (`createServer`). Absent during
  // development, where vite serves the two entry points itself and proxies
  // the API here; the line at the start says so out loud.
  const { application, interfaceDirectory } = await createServer(
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
      authenticationHandler: configuration.closed ? null : authenticationHandler(authentication),
      serverPaths,
    },
  )

  // Stopped in this order when the container runtime asks (`stopOnSignals`).
  // The mail job first: a pass that is running finishes, so that a message
  // is not sent and then forgotten because the pool closed before the row
  // could say so. The deadlines likewise, a reminder that has its mark gets
  // its task; and push, whose pass writes down what became of each message.
  let mailWorker: { readonly stop: () => Promise<void> } | null = null
  let deadlineWorker: { readonly stop: () => Promise<void> } | null = null
  let pushWorker: { readonly stop: () => Promise<void> } | null = null

  stopOnSignals(opengewerk.name, [
    () => mailWorker?.stop(),
    () => deadlineWorker?.stop(),
    () => pushWorker?.stop(),
    stopInstanceSettings,
    () => application.close(),
    () => database.close(),
  ])

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
    startupLine({
      name: opengewerk.name,
      host: configuration.host,
      port: configuration.port,
      interfaceServed: interfaceDirectory !== null,
      closed: configuration.closed,
      empty,
      setupCode: configuration.setupCode !== null,
      emptyInstance: access.sentences.emptyInstance,
    }),
  )
}

await runInstance(opengewerk.name, start)
