import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'
import {
  berlinClock,
  erasureKinds,
  type IsoDate,
  isPrivacyDocumentKind,
  isProcessingActivity,
  privacyDocumentTitles,
  processingActivities,
  type PrivacyDocumentsSummary,
  type ProcessingRecordView,
  recordText,
  unusedBecause,
} from '@opengewerk/domain'
import {
  accountsOf,
  Database,
  readMeasures,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Response } from 'express'

import { processingRecordActivities, processingRecordSettings } from '../database/schema/index.js'
import {
  dayInWords,
  deletionSettingsOf,
  keeperOf,
  madePrivacyDocument,
  privacyPrintJob,
  recordInputsOf,
  usedActivitiesOf,
  usesOf,
} from '../privacy/documents.js'
import { personLeads } from '../privacy/erasure.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** The reason the change log gives what whoever leads wrote for the record. */
const recordReason = 'privacy.record'

/** Why somebody who does not lead the business is refused. */
export const recordLeadersOnly =
  'Was das Verzeichnis der Verarbeitungstätigkeiten sagt, schreibt nur, wer den Betrieb führt.'

/** A text of the request as it is kept, or a 400 with the sentence that says why not. */
function text(body: unknown, field: string, label: string): string | null {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const kept = recordText(record[field], label)

  if (kept !== null && typeof kept === 'object') {
    throw new BadRequestException(kept.problem)
  }

  return kept
}

function today() {
  return berlinClock(new Date()).day
}

/**
 * The record of the processing and the three documents on data protection
 * (#319) under "Einstellungen, Datenschutz", read by whoever reads the
 * settings. What the record says, who is responsible, the data protection
 * officer, what is processed outside and per activity purpose, legal basis
 * and recipients, is written by whoever leads the business, as the policies
 * of both tables say; the routes ask first, so that a refusal is a sentence.
 * No right of its own, for the reason the deletion concept gives (ADR 0013).
 *
 * Each document is made fresh from the database whenever it is downloaded,
 * and nothing of it is kept (Moritz, 05.11.2026).
 */
@Controller('privacy')
export class PrivacyDocumentsController {
  constructor(
    private readonly database: Database,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  /** The record as its page shows it: the proposals, what was written, and which activities are used. */
  @Get('record')
  @RequiresPermission('settings.read')
  async read(@CurrentIdentity() identity: RequestIdentity): Promise<ProcessingRecordView> {
    const shown = await this.database.forTenant(identity, async (tx) => {
      const inputs = await recordInputsOf(tx)
      const uses = await usesOf(tx)
      const keeper = await keeperOf(tx)
      const [settings] = await tx
        .select({ updatedAt: processingRecordSettings.updatedAt })
        .from(processingRecordSettings)
      // Who changed it last, where the change log shows it to the person asking.
      const { rows: last } = await tx.execute<{ user_id: string | null }>(sql`
        select user_id from audit_entries
         where table_name = 'processing_record_settings'
         order by changed_at desc limit 1`)

      return {
        changedAt: settings?.updatedAt ?? null,
        changedBy: last[0]?.user_id ?? null,
        view: {
          controller: inputs.controller,
          proposedController: keeper.lines.join('\n'),
          officer: inputs.officer,
          outside: inputs.outside,
          activities: processingActivities.map((activity) => {
            const entry = inputs.activities[activity.key]

            return {
              key: activity.key,
              title: activity.title,
              subjects: activity.subjects,
              data: activity.data,
              deletion: activity.deletion,
              proposedPurpose: activity.purpose,
              proposedLegalBasis: activity.legalBasis,
              purpose: entry?.purpose ?? null,
              legalBasis: entry?.legalBasis ?? null,
              recipients: entry?.recipients ?? null,
              unused:
                activity.uses === 'always' || uses.has(activity.uses)
                  ? null
                  : unusedBecause[activity.uses],
            }
          }),
          leads: await personLeads(tx, identity.userId, today()),
        },
      }
    })
    const by =
      shown.changedBy === null
        ? null
        : ((await accountsOf(this.database, [shown.changedBy], identity.userId)).get(
            shown.changedBy,
          )?.name ?? null)

    return {
      ...shown.view,
      changed:
        shown.changedAt === null ? null : { on: berlinClock(shown.changedAt).day as IsoDate, by },
    }
  }

  /** What the three cards on "Datenschutz" say, before a document is downloaded. */
  @Get('documents')
  @RequiresPermission('settings.read')
  async summary(@CurrentIdentity() identity: RequestIdentity): Promise<PrivacyDocumentsSummary> {
    const instance = await readMeasures(this.database)

    return this.database.forTenant(identity, async (tx) => {
      const inputs = await recordInputsOf(tx)
      const used = await usedActivitiesOf(tx)
      const keeper = await keeperOf(tx)
      const deletion = await deletionSettingsOf(tx)
      const confirmed = [...used].filter((key) => inputs.activities[key]?.purpose != null).length

      return {
        record: {
          controller:
            inputs.controller === null
              ? `${[keeper.name, keeper.address].filter((line) => line !== '').join(', ')} (aus dem Briefkopf)`
              : (inputs.controller.split('\n')[0] ?? ''),
          officer: inputs.officer === null ? null : (inputs.officer.split('\n')[0] ?? ''),
          used: used.size,
          confirmed,
          unused: processingActivities.length - used.size,
        },
        measures: {
          changedOn:
            instance.changedAt === null
              ? null
              : (berlinClock(new Date(instance.changedAt)).day as IsoDate),
          subprocessors: instance.subprocessors.length,
        },
        deletion: {
          kinds: erasureKinds.length,
          automatic: deletion.automatic,
          prospectMonths: deletion.prospectMonths,
          customerMonths: deletion.customerMonths,
        },
      }
    })
  }

  /** Who is responsible, the data protection officer and what is processed outside; an empty text is none. */
  @Put('record')
  @RequiresPermission('settings.read')
  async keep(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<ProcessingRecordView> {
    const controller = text(body, 'controller', 'Verantwortlicher')
    const officer = text(body, 'officer', 'Datenschutzbeauftragter')
    const outside = text(body, 'outside', 'Verarbeitungen außerhalb von OpenGewerk')
    const writing = { tenantId: identity.tenantId, userId: identity.userId, reason: recordReason }

    await this.database.forTenant(writing, async (tx) => {
      if (!(await personLeads(tx, identity.userId, today()))) {
        throw new ForbiddenException(recordLeadersOnly)
      }

      await tx
        .insert(processingRecordSettings)
        .values({ tenantId: identity.tenantId, controller, officer, outside })
        .onConflictDoUpdate({
          target: processingRecordSettings.tenantId,
          set: { controller, officer, outside, updatedAt: sql`now()` },
        })
    })

    return this.read(identity)
  }

  /**
   * What whoever leads writes for one activity. A purpose and a legal basis
   * confirm the activity together; both empty, the proposal stands again.
   */
  @Put('record/activities/:key')
  @RequiresPermission('settings.read')
  async keepActivity(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<ProcessingRecordView> {
    if (!isProcessingActivity(key)) {
      throw new NotFoundException()
    }

    const purpose = text(body, 'purpose', 'Zweck')
    const legalBasis = text(body, 'legalBasis', 'Rechtsgrundlage')
    const recipients = text(body, 'recipients', 'Empfänger')

    if ((purpose === null) !== (legalBasis === null)) {
      throw new BadRequestException(
        'Zweck und Rechtsgrundlage gehören zusammen: beide, oder keines für den Vorschlag der Anwendung.',
      )
    }

    const writing = { tenantId: identity.tenantId, userId: identity.userId, reason: recordReason }

    await this.database.forTenant(writing, async (tx) => {
      if (!(await personLeads(tx, identity.userId, today()))) {
        throw new ForbiddenException(recordLeadersOnly)
      }

      await tx
        .insert(processingRecordActivities)
        .values({ tenantId: identity.tenantId, activity: key, purpose, legalBasis, recipients })
        .onConflictDoUpdate({
          target: [processingRecordActivities.tenantId, processingRecordActivities.activity],
          set: { purpose, legalBasis, recipients, updatedAt: sql`now()` },
        })
    })

    return this.read(identity)
  }

  /** One of the three documents as a PDF, made now. */
  @Get('documents/:kind')
  @RequiresPermission('settings.read')
  async print(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('kind') kind: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isPrivacyDocumentKind(kind)) {
      throw new NotFoundException()
    }

    const at = new Date()
    const made = await this.database.forTenant(identity, (tx) =>
      madePrivacyDocument(this.database, tx, kind, at),
    )
    let bytes: Uint8Array

    try {
      bytes = await this.render(privacyPrintJob(kind, made.markdown, made.keeper, at), identity)
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    const name =
      `${privacyDocumentTitles[kind]} ${made.keeper.name} ${dayInWords(berlinClock(at).day)}.pdf`.replaceAll(
        /[/\\:*?"<>|]+/g,
        '-',
      )

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `attachment; filename="Datenschutz.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      length: bytes.byteLength,
    })
  }
}
