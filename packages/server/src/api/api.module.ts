import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'

import type { Authentication } from '../authentication/authentication.js'
import { AuthenticationController } from '../authentication/authentication.controller.js'
import { Database } from '../database/database.js'
import { AuthorizationGuard } from './authorization.js'
import { CustomersController } from './customers.controller.js'
import { DatabaseExceptionFilter } from './database-errors.js'
import { DocumentLinesController, DocumentTotalsController } from './document-lines.controller.js'
import { DocumentsController } from './documents.controller.js'
import { HealthController } from './health.controller.js'
import { IDENTITY_SOURCE, type IdentitySource } from './identity.js'
import { InstallationsController } from './installations.controller.js'
import { JobsController } from './jobs.controller.js'
import { SettingsController } from './settings.controller.js'
import { AUTHENTICATION, SetupController, TRUSTED_ORIGINS } from './setup.controller.js'
import { SitesController } from './sites.controller.js'
import { SyncController } from './sync.controller.js'

/**
 * What the module needs beyond a database and an identity source.
 *
 * The authentication is handed in only when the instance is open, and that is
 * what switches the first run setup on. Left out, the controller is not
 * registered and its routes do not exist: a closed instance hands out nothing,
 * and a way in that stayed open during a restore would take the meaning out of
 * `CLOSED`.
 */
export interface ApiOptions {
  readonly authentication?: Authentication
  /**
   * The addresses a browser may send a first run from. Only read when the
   * authentication is there, because the route that needs it only exists then.
   */
  readonly trustedOrigins?: readonly string[]
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
export class ApiModule {
  static create(
    database: Database,
    identities: IdentitySource,
    options: ApiOptions = {},
  ): DynamicModule {
    const { authentication, trustedOrigins = [] } = options

    return {
      module: ApiModule,
      controllers: [
        HealthController,
        ...(authentication ? [SetupController] : []),
        AuthenticationController,
        CustomersController,
        SitesController,
        InstallationsController,
        JobsController,
        DocumentsController,
        DocumentLinesController,
        DocumentTotalsController,
        SyncController,
        SettingsController,
      ],
      providers: [
        { provide: Database, useValue: database },
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
