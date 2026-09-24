import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { largestAttachmentBytes, largestLogoBytes, logoMediaTypes } from '@opengewerk/domain'
import { raw } from 'express'

import type { Authentication } from '../authentication/authentication.js'
import { AuthenticationController } from '../authentication/authentication.controller.js'
import { RecoveryCodesController } from '../authentication/recovery-codes.controller.js'
import { Database } from '../database/database.js'
import { type Renderer, rendererFor } from '../documents/renderer.js'
import { type FileStorage, noFileStorage } from '../storage/file-store.js'
import { AttachmentsController } from './attachments.controller.js'
import { AuthorizationGuard } from './authorization.js'
import { BackupStatusController } from './backup-status.controller.js'
import { CircuitChartController } from './circuit-chart.controller.js'
import { ContactsController } from './contacts.controller.js'
import { CustomersController } from './customers.controller.js'
import { DatabaseExceptionFilter } from './database-errors.js'
import { DocumentFiles } from './document-files.js'
import { DocumentInstructionsController } from './document-instructions.controller.js'
import { PaymentsController } from './payments.controller.js'
import { DocumentLinesController, DocumentTotalsController } from './document-lines.controller.js'
import { DocumentMailController } from './document-mail.controller.js'
import { DocumentPdfController } from './document-pdf.controller.js'
import { DocumentsController } from './documents.controller.js'
import { EInvoiceController } from './e-invoice.controller.js'
import { FilesController, fileUploadType } from './files.controller.js'
import { HealthController } from './health.controller.js'
import { IDENTITY_SOURCE, type IdentitySource } from './identity.js'
import { InstallationsController } from './installations.controller.js'
import { InstructionsController } from './instructions.controller.js'
import { JobsController } from './jobs.controller.js'
import { LetterheadController } from './letterhead.controller.js'
import { MailSettingsController } from './mail-settings.controller.js'
import { NumberRangesController } from './number-ranges.controller.js'
import { SettingsController } from './settings.controller.js'
import {
  AUTHENTICATION,
  BACKUP_STATUS,
  FILE_STORE,
  MAIL,
  type MailContext,
  RENDERER,
  TRUSTED_ORIGINS,
} from './handed-in.js'
import { InvitationController } from './invitation.controller.js'
import { SameOriginGuard } from './origin.js'
import { SetupController } from './setup.controller.js'
import { StaffController } from './staff.controller.js'
import { SitesController } from './sites.controller.js'
import { SyncController } from './sync.controller.js'
import { TasksController } from './tasks.controller.js'
import { TextSnippetsController } from './text-snippets.controller.js'
import { TimeController } from './time.controller.js'

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
   * The addresses a browser may send a request that changes something from,
   * the same list better-auth gets. Left out, no browser may: a request with
   * an `Origin` is refused, one without passes, as from `curl` or a test.
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
  /**
   * What the routes around mail need. Left out, the instance sends none, and
   * every route that would refuses with the sentence saying so.
   */
  readonly mail?: MailContext | null
  /**
   * Where the backups record their last run. Left out, the office is told
   * that nothing is known about backups, which is the truth on a machine
   * that makes none, and is not warned.
   */
  readonly backupStatus?: string | null
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
   * The two routes that take a body that is not JSON: the logo, as the image
   * itself, and the bytes of a file for the records (#77). Read as raw bytes
   * there and nowhere else, so that no other route can be sent megabytes of
   * something it does not expect.
   *
   * The limits sit above the ones the controllers enforce, so that a file
   * just over one gets the controller's sentence and not the parser's.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(raw({ type: [...logoMediaTypes], limit: largestLogoBytes * 2 }))
      .forRoutes({ path: 'settings/letterhead/logo', method: RequestMethod.PUT })
    consumer
      .apply(raw({ type: [fileUploadType], limit: largestAttachmentBytes * 2 }))
      .forRoutes({ path: 'files/:sha256', method: RequestMethod.PUT })
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
      mail = null,
      backupStatus = null,
    } = options

    return {
      module: ApiModule,
      controllers: [
        HealthController,
        // All three need the authentication handed in and are left out on a
        // closed instance, which is what leaving the authentication out does.
        // The first two answer without an identity.
        ...(authentication ? [SetupController, InvitationController, RecoveryCodesController] : []),
        AuthenticationController,
        StaffController,
        CustomersController,
        ContactsController,
        SitesController,
        InstallationsController,
        CircuitChartController,
        JobsController,
        TasksController,
        FilesController,
        AttachmentsController,
        TimeController,
        // Before the documents, whose routes take an id in the same place.
        // None of them clashes with this path today, and this order keeps it
        // that way when one is added that would.
        TextSnippetsController,
        DocumentsController,
        DocumentLinesController,
        DocumentTotalsController,
        DocumentPdfController,
        EInvoiceController,
        DocumentMailController,
        DocumentInstructionsController,
        PaymentsController,
        SyncController,
        SettingsController,
        InstructionsController,
        MailSettingsController,
        NumberRangesController,
        LetterheadController,
        BackupStatusController,
      ],
      providers: [
        { provide: Database, useValue: database },
        { provide: FILE_STORE, useValue: files },
        { provide: RENDERER, useValue: renderer },
        { provide: MAIL, useValue: mail },
        { provide: BACKUP_STATUS, useValue: backupStatus },
        DocumentFiles,
        ...(authentication ? [{ provide: AUTHENTICATION, useValue: authentication }] : []),
        { provide: TRUSTED_ORIGINS, useValue: trustedOrigins },
        { provide: IDENTITY_SOURCE, useValue: identities },
        // In this order, which is the order Nest runs them in: a form from a
        // foreign page is refused before anybody asks whose session it carries.
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
      ],
    }
  }
}
