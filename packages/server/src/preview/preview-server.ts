import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { Identity } from '@opengewerk/domain'

import { ApiModule } from '../api/api.module.js'
import { authenticationPath } from '../authentication/authentication.js'
import type { Database } from '../database/database.js'
import { readRendererConfiguration, rendererFor } from '../documents/renderer.js'
import { interfacePath, serveInterface } from '../interface.js'
import { smtpTransport } from '../mail/transport.js'
import { SecretKey } from '../secrets/key.js'
import { FileStore } from '../storage/file-store.js'
import { previewUser } from './preview-database.js'
import { PreviewIdentitySource, previewSession } from './preview-identity.js'

/**
 * The server as an installation runs it, with one difference: nobody signs
 * in, and every request counts as the given person in the given business.
 *
 * Built for looking at the interface in a browser, by a developer and by an
 * assistant, without an account and without a password. The module, the
 * guard, row level security, the routes and the interface are the ones an
 * installation runs; only where the identity comes from is different.
 *
 * Not listening yet. The entry point listens on 127.0.0.1, the test on a port
 * the system picks.
 */
export async function openPreview(
  database: Database,
  identity: Identity,
): Promise<INestApplication> {
  const application = await NestFactory.create(
    ApiModule.create(database, new PreviewIdentitySource(identity), {
      files: new FileStore(mkdtempSync(join(tmpdir(), 'opengewerk-vorschau-'))),
      // RENDERER_URL and RENDERER_TOKEN as on an instance. Without them a PDF
      // gets the sentence that says which service is missing.
      renderer: rendererFor(readRendererConfiguration()),
      // The mail settings can be set up and checked, and nothing is sent: the
      // preview runs no mail job. Its own key, because a preview database is
      // nobody's and has no SESSION_SECRET to keep.
      mail: {
        origin: 'http://127.0.0.1:3000',
        key: SecretKey.from('opengewerk preview, sealed for this machine only'),
        connect: smtpTransport,
      },
    }),
    { logger: ['error', 'warn'] },
  )

  application.use(authenticationPath, previewSession(identity, previewUser))
  application.getHttpAdapter().getInstance().disable('x-powered-by')

  const built = interfacePath()

  if (built) {
    serveInterface(application.getHttpAdapter().getInstance(), built)
  }

  return application
}
