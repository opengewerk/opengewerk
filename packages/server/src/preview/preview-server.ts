import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Identity } from '@opengewerk/domain'

import { ApiModule } from '../api/api.module.js'
import { readJsonBodiesOnly } from '../api/origin.js'
import { authenticationPath } from '../authentication/authentication.js'
import type { Database } from '../database/database.js'
import { readRendererConfiguration, rendererFor } from '../documents/renderer.js'
import { interfacePath, serveInterface } from '../interface.js'
import { sendSecurityHeaders } from '../security-headers.js'
import { mailInternalHosts } from '../configuration.js'
import { reachableOnly } from '../mail/reach.js'
import { smtpTransport } from '../mail/transport.js'
import { SecretKey } from '../secrets/key.js'
import { FileStore } from '../storage/file-store.js'
import { previewPort, previewUser } from './preview-database.js'
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
  const address = `http://127.0.0.1:${String(previewPort())}`
  const application = await NestFactory.create<NestExpressApplication>(
    ApiModule.create(database, new PreviewIdentitySource(identity), {
      // The address the preview is opened at, the same port under its other
      // name, vite's, which passes the page's own origin on when it serves the
      // interface next to the preview, and the name a container on this
      // machine reaches it by: the browser of the renderer image, which the
      // check of the widths and the pictures next to the boards use, and which
      // could not save anything before (#254). Anything else sending a change
      // is taken for a form from somewhere else, as on an instance.
      trustedOrigins: [
        address,
        `http://localhost:${String(previewPort())}`,
        `http://host.docker.internal:${String(previewPort())}`,
        'http://127.0.0.1:5173',
        'http://localhost:5173',
      ],
      files: new FileStore(mkdtempSync(join(tmpdir(), 'opengewerk-vorschau-'))),
      // RENDERER_URL and RENDERER_TOKEN as on an instance. Without them a PDF
      // gets the sentence that says which service is missing.
      renderer: rendererFor(readRendererConfiguration()),
      // The mail settings can be set up and checked, and nothing is sent: the
      // preview runs no mail job. Its own key, because a preview database is
      // nobody's and has no SESSION_SECRET to keep.
      mail: {
        origin: address,
        key: SecretKey.from('opengewerk preview, sealed for this machine only'),
        // Held to the same rule as an instance. A mail server on this machine,
        // for trying things out, goes into MAIL_INTERNAL_HOSTS.
        connect: reachableOnly(smtpTransport, {
          internalHosts: mailInternalHosts(process.env),
        }),
      },
    }),
    { logger: ['error', 'warn'], bodyParser: false },
  )

  sendSecurityHeaders(application.getHttpAdapter().getInstance())
  application.use(authenticationPath, previewSession(identity, previewUser))
  readJsonBodiesOnly(application)
  application.getHttpAdapter().getInstance().disable('x-powered-by')

  const built = interfacePath()

  if (built) {
    serveInterface(application.getHttpAdapter().getInstance(), built)
  }

  return application
}
