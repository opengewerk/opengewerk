import 'reflect-metadata'

import type { Identity, IsoDate } from '@opengewerk/domain'

import { Database } from '../database/database.js'
import { newId } from '../database/identifier.js'
import { applicationDatabaseUrl } from '../database/test-database.js'
import { interfacePath } from '../interface.js'
import {
  admitPreviewUser,
  preparePreviewDatabase,
  previewDatabaseUrl,
  previewPort,
  PreviewRefused,
  previewRoles,
  previewUser,
  refuseProduction,
} from './preview-database.js'
import { openPreview } from './preview-server.js'
import { plantSampleData } from './sample-data.js'

/**
 * Starts the preview: `pnpm run preview` in the root of the repository, which
 * builds the interface first.
 *
 * A fresh database with a sample business on every start, the server on
 * 127.0.0.1, and every request counted as the owner of that business. What
 * keeps this away from an installation is written at each fence: this folder
 * is not compiled into `dist`, the start is refused under
 * `NODE_ENV=production` and against a database that is not local or not
 * named for the purpose, and the address to listen on is not configurable.
 */

/** Today where the sample business is, not in UTC. */
function today(): IsoDate {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
}

async function start(): Promise<void> {
  refuseProduction()

  const url = previewDatabaseUrl()
  const port = previewPort()
  // A new business on every start, and with it a new local copy in the
  // browser. The copy of the last start would otherwise sit ahead of a
  // database that was just emptied.
  const tenant = { id: newId<'tenant'>(), name: 'Elektro Nord GmbH (Vorschau)' }

  const admin = await preparePreviewDatabase(url)

  try {
    await admitPreviewUser(admin, tenant)
  } finally {
    await admin.end()
  }

  const identity: Identity = { userId: previewUser.id, tenantId: tenant.id, roles: previewRoles }
  const database = Database.connect(applicationDatabaseUrl(url))
  const application = await openPreview(database, identity)

  // 127.0.0.1 and nothing else, whatever HOST says. A server that lets every
  // request through has no business on an interface somebody else can reach.
  await application.listen(port, '127.0.0.1')

  const address = `http://127.0.0.1:${String(port)}`

  await plantSampleData(address, today())

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void application.close().then(() => database.close())
    })
  }

  console.info(
    `Die Vorschau läuft unter ${address}. Jede Anfrage läuft ohne Anmeldung mit der Rolle ` +
      `Inhaber in "${tenant.name}". Die Beispieldaten entstehen bei jedem Start neu; ` +
      'was hier geändert wird, ist beim nächsten Start wieder weg.' +
      (interfacePath()
        ? ''
        : ' Es ist keine gebaute Oberfläche dabei; "pnpm run preview" im Wurzelverzeichnis ' +
          'baut sie mit.'),
  )
}

try {
  await start()
} catch (error) {
  // A refusal gets its sentence and nothing else, like a configuration
  // mistake on an instance: a stack trace above it buries what to do.
  if (error instanceof PreviewRefused) {
    console.error(error.message)
  } else {
    console.error('Die Vorschau konnte nicht starten.', error)
  }

  process.exitCode = 1
}
