import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { largestLogoBytes, logoMediaTypes } from '@opengewerk/domain'
import { raw } from 'express'

import type { Authentication } from '../authentication/authentication.js'
import { AuthenticationController } from '../authentication/authentication.controller.js'
import { Database } from '../database/database.js'
import { type Renderer, rendererFor } from '../documents/renderer.js'
import { type FileStorage, noFileStorage } from '../storage/file-store.js'
import { AuthorizationGuard } from './authorization.js'
import { CustomersController } from './customers.controller.js'
import { DatabaseExceptionFilter } from './database-errors.js'
import { DocumentLinesController, DocumentTotalsController } from './document-lines.controller.js'
import { DocumentPdfController } from './document-pdf.controller.js'
import { DocumentsController } from './documents.controller.js'
import { HealthController } from './health.controller.js'
import { IDENTITY_SOURCE, type IdentitySource } from './identity.js'
import { InstallationsController } from './installations.controller.js'
import { JobsController } from './jobs.controller.js'
import { LetterheadController } from './letterhead.controller.js'
import { SettingsController } from './settings.controller.js'
import { AUTHENTICATION, FILE_STORE, RENDERER, TRUSTED_ORIGINS } from './handed-in.js'
import { InvitationController } from './invitation.controller.js'
import { SetupController } from './setup.controller.js'
import { StaffController } from './staff.controller.js'
import { SitesController } from './sites.controller.js'
import { SyncController } from './sync.controller.js'

/**
 * What the module needs beyond a database and an identity source.
 *
 * The authentication is handed in only when the instance is open, and that is
 * what switches the two public parts on: the first run setup and the
 * redemption of an invitation link. Left out, neither controller is
 * registered and their routes do not exist: a closed instance hands out
 * nothing, and a way in that stayed open during a restore would take the
 * meaning out of `CLOSED`.
 */
export interface ApiOptions {
  readonly authentication?: Authentication
  /**
   * The addresses a browser may send a first run or a redeemed invitation
   * from. Only read when the authentication is there, because the routes that
   * need it only exist then.
   */
  readonly trustedOrigins?: readonly string[]
  /**
   * Where files are kept. Left out, every route that needs one refuses with a
   * sentence, which is what a test that never touches a file wants.
   */
  readonly files?: FileStorage
  /**
   * What prints a document. Left out, it is the renderer of an instance that
   * has none configured, and a request for a PDF gets the message saying so.
   */
  readonly renderer?: Renderer
}

/**
 * The HTTP side. An identity source has to be handed in; there is no default,
 * because the only one that could be written today would let everybody
 * through. `main.ts` hands in a source that recognises nobody instead, so an
 * instance can run and be checked while every route behind the guard answers
 * 401. See `closed-identity.ts` for why that is the safe end of the choice.
 *
 * The guard is registered globally rather than per controller. Per controller
 * it would be a decision somebody has to remember on the next one; globally it
 * is the default, and a route that declares no right is refused instead of
 * waved through.
 */
@Module({})
export class ApiModule implements NestModule {
  /**
   * The one route that takes a body that is not JSON: the logo, as the image
   * itself. Read as raw bytes there and nowhere else, so that no other route
   * can be sent a megabyte of something it does not expect.
   *
   * The limit sits above the one the controller enforces, so that a logo
   * just over it gets the controller's sentence and not the parser's.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(raw({ type: [...logoMediaTypes], limit: largestLogoBytes * 2 }))
      .forRoutes({ path: 'settings/letterhead/logo', method: RequestMethod.PUT })
  }

  static create(
    database: Database,
    identities: IdentitySource,
    options: ApiOptions = {},
  ): DynamicModule {
    const {
      authentication,
      trustedOrigins = [],
      files = noFileStorage,
      renderer = rendererFor({ url: undefined, token: undefined }),
    } = options

    return {
      module: ApiModule,
      controllers: [
        HealthController,
        // Both of these answer without an identity and both are left out on a
        // closed instance, which is what leaving the authentication out does.
        ...(authentication ? [SetupController, InvitationController] : []),
        AuthenticationController,
        StaffController,
        CustomersController,
        SitesController,
        InstallationsController,
        JobsController,
        DocumentsController,
        DocumentLinesController,
        DocumentTotalsController,
        DocumentPdfController,
        SyncController,
        SettingsController,
        LetterheadController,
      ],
      providers: [
        { provide: Database, useValue: database },
        { provide: FILE_STORE, useValue: files },
        { provide: RENDERER, useValue: renderer },
        ...(authentication
          ? [
              { provide: AUTHENTICATION, useValue: authentication },
              { provide: TRUSTED_ORIGINS, useValue: trustedOrigins },
            ]
          : []),
        { provide: IDENTITY_SOURCE, useValue: identities },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
      ],
    }
  }
}
