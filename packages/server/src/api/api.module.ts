import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { auditVocabulary, largestLogoBytes, logoMediaTypes } from '@opengewerk/domain'
import {
  auditLogParts,
  type Authentication,
  authenticationParts,
  AUTHORIZATION,
  backupStatusParts,
  Database,
  fileParts,
  type FileStorage,
  HealthController,
  type InstanceSettingsCache,
  MAIL,
  type MailContext,
  mailSettingsParts,
  parseFileUploads,
  PUSH,
  type PushContext,
  pushParts,
  RENDERER,
  type Renderer,
  rendererFor,
  SameOriginGuard,
  type SecretKey,
  syncParts,
  TRUSTED_ORIGINS,
  VERSION,
} from '@opengewerk/platform-server'
import { raw } from 'express'

import { access } from '../authentication/access.js'
import { ArticleImports } from '../datanorm/imports.js'
import { mailServersOfBusinesses } from '../mail/server-settings.js'
import { invitationMailing } from '../notifications/invitation-mail.js'
import { pushRules } from '../notifications/push.js'
import { ArticleImportsController } from './article-imports.controller.js'
import { ArticlesController } from './articles.controller.js'
import { AttachmentsController } from './attachments.controller.js'
import { authorization, AuthorizationGuard } from './authorization.js'
import { CircuitChartController } from './circuit-chart.controller.js'
import { InstallationLabelsController } from './installation-labels.controller.js'
import { CollectiveInvoicesController } from './collective-invoices.controller.js'
import { ContactsController } from './contacts.controller.js'
import { CustomersController } from './customers.controller.js'
import { DatabaseExceptionFilter } from './database-errors.js'
import { DocumentFiles } from './document-files.js'
import { DocumentInstructionsController } from './document-instructions.controller.js'
import { OpenPaymentsController, PaymentsController } from './payments.controller.js'
import { DocumentLinesController, DocumentTotalsController } from './document-lines.controller.js'
import { DocumentMailController } from './document-mail.controller.js'
import { DocumentPdfController } from './document-pdf.controller.js'
import { DocumentsController } from './documents.controller.js'
import { EInvoiceController } from './e-invoice.controller.js'
import { FormRecordsController } from './form-records.controller.js'
import { IDENTITY_SOURCE, type IdentitySource } from './identity.js'
import { InstallationsController } from './installations.controller.js'
import { InstructionsController } from './instructions.controller.js'
import { JobsController } from './jobs.controller.js'
import { LetterheadController } from './letterhead.controller.js'
import { NumberRangesController } from './number-ranges.controller.js'
import { ReportFieldsController } from './report-fields.controller.js'
import { SettingsController } from './settings.controller.js'
import { SECRETS } from './handed-in.js'
import { SiteAccessesController } from './site-accesses.controller.js'
import { SitesController } from './sites.controller.js'
import { SuppliersController } from './suppliers.controller.js'
import { syncRoutes } from './sync-routes.js'
import { TagsController } from './tags.controller.js'
import { TasksController } from './tasks.controller.js'
import { DeadlineSettingsController, DeadlinesController } from './deadlines.controller.js'
import { TenantsController } from './tenants.controller.js'
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
   * The code the first run asks for (#215), from `SETUP_CODE`. Left out, an
   * empty instance cannot be set up at all: the first run is refused with the
   * sentence saying that `sh docker/start.sh` adds one. Only read where the
   * authentication is handed in, because only then is there a first run.
   */
  readonly setupCode?: string | null
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
  /**
   * The version this installation runs (#259), which the health check names
   * and the foot of the sign in shows. Left out, there is none to name.
   */
  readonly version?: string | null
  /**
   * What push needs (#284). Left out, the instance sends no push: "Konto"
   * says so, and the routes that would send refuse with the reason.
   */
  readonly push?: PushContext | null
  /**
   * The key the ways into a site are sealed with (#286). Left out, the key of
   * the mail context, which is the same one; without either, a route that
   * would seal refuses with the reason.
   */
  readonly secrets?: SecretKey | null
  /**
   * The settings of the instance in memory (#188), so that a change made in
   * its area reaches the mail check at once. Left out, the area reads and
   * writes the database and nothing is kept.
   */
  readonly instance?: { readonly settings: InstanceSettingsCache } | null
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
   * itself, and the bytes of a file for the records (#77), whose parser comes
   * with the route of the foundation. Read as raw bytes there and nowhere
   * else, so that no other route can be sent megabytes of something it does
   * not expect.
   *
   * The limits sit above the ones the controllers enforce, so that a file
   * just over one gets the controller's sentence and not the parser's.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(raw({ type: [...logoMediaTypes], limit: largestLogoBytes * 2 }))
      .forRoutes({ path: 'settings/letterhead/logo', method: RequestMethod.PUT })
    parseFileUploads(consumer)
  }

  static create(
    database: Database,
    identities: IdentitySource,
    options: ApiOptions = {},
  ): DynamicModule {
    const {
      authentication,
      setupCode = null,
      trustedOrigins = [],
      files,
      renderer = rendererFor({ url: undefined, token: undefined }),
      mail = null,
      backupStatus = null,
      version = null,
      push = null,
    } = options

    // The authentication is the foundation's, with the roles and the words of
    // this application. Its ways in, the first run and the one time link, are
    // there only while the authentication is handed in, which is what leaves
    // them out on a closed instance. Who works in a business is part of it,
    // and an invitation by mail goes out the way every message here does. The
    // area of the instance (#188) comes with it.
    const signingIn = authenticationParts({
      access,
      authentication,
      setupCode,
      invitationMailing: invitationMailing(database, mail),
      instanceSettings: options.instance?.settings,
    })
    // The key the ways into a site are sealed with (#286), the one of the mail
    // context where none is handed in on its own.
    const secrets = options.secrets ?? mail?.key ?? null
    // The routes a device syncs through are the foundation's; the right each
    // operation asks for and what a device holds are this application's.
    const syncing = syncParts({ access, routes: syncRoutes(secrets) })
    // The change log of the business, read by the foundation in the words of the office.
    const auditing = auditLogParts({ access, vocabulary: auditVocabulary })
    // The bytes of the files in the records go into the store through the
    // route of the foundation, under the right of the records (#77).
    const storing = fileParts({ access, upload: 'attachment.write', store: files })
    // When the last backup ran, for whoever reads the settings (#130).
    const backingUp = backupStatusParts({ access, read: 'settings.read', directory: backupStatus })
    // The mail server of the business, set up by whoever may write in its name
    // (#102); whether it sends at all, for whoever reads the settings.
    const pushing = pushParts({ access, rights: { write: 'push.write' }, rules: pushRules })
    const mailing = mailSettingsParts({
      access,
      rights: { status: 'settings.read', read: 'mail.read', write: 'mail.write' },
      servers: mailServersOfBusinesses,
    })

    return {
      module: ApiModule,
      controllers: [
        HealthController,
        ...signingIn.controllers,
        CustomersController,
        TagsController,
        ContactsController,
        SuppliersController,
        ArticleImportsController,
        ArticlesController,
        SitesController,
        SiteAccessesController,
        InstallationsController,
        CircuitChartController,
        InstallationLabelsController,
        FormRecordsController,
        JobsController,
        CollectiveInvoicesController,
        TasksController,
        DeadlinesController,
        DeadlineSettingsController,
        ...pushing.controllers,
        ...auditing.controllers,
        TenantsController,
        ...storing.controllers,
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
        OpenPaymentsController,
        ...syncing.controllers,
        SettingsController,
        ReportFieldsController,
        InstructionsController,
        ...mailing.controllers,
        NumberRangesController,
        LetterheadController,
        ...backingUp.controllers,
      ],
      providers: [
        { provide: Database, useValue: database },
        { provide: RENDERER, useValue: renderer },
        { provide: MAIL, useValue: mail },
        { provide: VERSION, useValue: version },
        { provide: PUSH, useValue: push },
        { provide: SECRETS, useValue: secrets },
        DocumentFiles,
        ArticleImports,
        ...signingIn.providers,
        ...syncing.providers,
        ...auditing.providers,
        ...storing.providers,
        ...backingUp.providers,
        ...mailing.providers,
        ...pushing.providers,
        { provide: TRUSTED_ORIGINS, useValue: trustedOrigins },
        { provide: IDENTITY_SOURCE, useValue: identities },
        // What a right is and who holds it, for the guard of the foundation.
        { provide: AUTHORIZATION, useValue: authorization },
        // In this order, which is the order Nest runs them in: a form from a
        // foreign page is refused before anybody asks whose session it carries.
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
      ],
    }
  }
}
