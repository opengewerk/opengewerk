import {
  berlinClock,
  coreDeadlineKinds,
  type DeletionSettings,
  describeDeletion,
  describeMeasures,
  describeRecord,
  erasureKinds,
  erasureKindWords,
  type IsoDate,
  isProcessingActivity,
  type PrivacyDocumentKind,
  privacyDocumentTitles,
  type ProcessingActivityEntry,
  type ProcessingActivityKey,
  processingActivities,
  type ProcessingRecordInputs,
  type ProcessingUse,
} from '@opengewerk/domain'
import {
  addressLines,
  type Database,
  markdownHtml,
  present,
  type PrintJob,
  readMeasures,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { deadlineSettings } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'

import { type GridParty, sheetHead, sheetJob } from '../forms/grid-documents.js'
import {
  erasureAutomations,
  letterheads,
  processingRecordActivities,
  processingRecordSettings,
  tenants,
} from '../database/schema/index.js'
import { measuresTemplate } from './template.js'

/**
 * The three documents on data protection of a business (#319): the record of
 * the processing, the technical and organisational measures and the deletion
 * concept, each made fresh from what the database holds whenever it is
 * downloaded (Moritz, 05.11.2026).
 */

/** "am 05.11.2026 um 10:40", in German time. */
export function atInWords(at: Date): string {
  const clock = berlinClock(at)
  const hours = String(Math.floor(clock.minute / 60)).padStart(2, '0')
  const minutes = String(clock.minute % 60).padStart(2, '0')

  return `am ${dayInWords(clock.day)} um ${hours}:${minutes}`
}

/** "05.11.2026" */
export function dayInWords(on: string): string {
  return `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`
}

/** What whoever leads wrote for the record, out of its two tables. */
export async function recordInputsOf(tx: TenantTransaction): Promise<ProcessingRecordInputs> {
  const [settings] = await tx
    .select({
      controller: processingRecordSettings.controller,
      officer: processingRecordSettings.officer,
      outside: processingRecordSettings.outside,
    })
    .from(processingRecordSettings)
  const rows = await tx
    .select({
      activity: processingRecordActivities.activity,
      purpose: processingRecordActivities.purpose,
      legalBasis: processingRecordActivities.legalBasis,
      recipients: processingRecordActivities.recipients,
    })
    .from(processingRecordActivities)
  const activities: Partial<Record<ProcessingActivityKey, ProcessingActivityEntry>> = {}

  for (const row of rows) {
    // A row of an activity the application no longer knows stays out of the record.
    if (isProcessingActivity(row.activity)) {
      activities[row.activity] = {
        purpose: row.purpose,
        legalBasis: row.legalBasis,
        recipients: row.recipients,
      }
    }
  }

  return {
    controller: settings?.controller ?? null,
    officer: settings?.officer ?? null,
    outside: settings?.outside ?? null,
    activities,
  }
}

/**
 * Which uses the business has, from its data. A lead, a year of working time
 * and a file the deletion concept took count as used: the record says what
 * the business did with the application, not only what is left of it.
 */
export async function usesOf(tx: TenantTransaction): Promise<ReadonlySet<ProcessingUse>> {
  const { rows } = await tx.execute<Record<Exclude<ProcessingUse, 'always'>, boolean>>(sql`
    select
      exists (select 1 from prospects)
        or exists (select 1 from erasures where kind = 'prospect') as prospects,
      exists (select 1 from installations where grid_operator_id is not null) as grid,
      exists (select 1 from calendar_feeds where ended_at is null) as calendar,
      exists (select 1 from time_entries)
        or exists (select 1 from erasures where kind = 'staff_year') as time,
      exists (select 1 from people)
        or exists (select 1 from erasures where kind = 'person') as staff,
      exists (select 1 from mail_settings) as mail,
      exists (select 1 from push_subscriptions) as push`)
  const found = rows[0]
  const uses = new Set<ProcessingUse>(['always'])

  if (found !== undefined) {
    for (const [use, used] of Object.entries(found)) {
      if (used) {
        uses.add(use as ProcessingUse)
      }
    }
  }

  return uses
}

/** The activities the business uses. */
export async function usedActivitiesOf(
  tx: TenantTransaction,
): Promise<ReadonlySet<ProcessingActivityKey>> {
  const uses = await usesOf(tx)

  return new Set(
    processingActivities
      .filter((activity) => uses.has(activity.uses))
      .map((activity) => activity.key as ProcessingActivityKey),
  )
}

/** The business as its letterhead names it, else by the name of the tenant. */
export async function keeperOf(tx: TenantTransaction): Promise<GridParty & { lines: string[] }> {
  const [letterhead] = await tx.select().from(letterheads).limit(1)
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants).limit(1)
  const name = present(letterhead?.companyName) ? letterhead.companyName : (tenant?.name ?? '')
  const address = letterhead ? addressLines(letterhead, 'DE').join(', ') : ''
  // Two lines, as the record proposes them: who and where, then who
  // represents the business and how it is reached.
  const lines = [
    [name, address],
    [
      present(letterhead?.managingDirectors)
        ? `vertreten durch ${letterhead.managingDirectors}`
        : '',
      letterhead?.email ?? '',
      letterhead?.phone ?? '',
    ],
  ]
    .map((parts) => parts.filter((part) => part.trim() !== '').join(', '))
    .filter((line) => line !== '')

  return {
    name,
    address,
    phone: letterhead?.phone ?? null,
    email: letterhead?.email ?? null,
    lines,
  }
}

/** How many months a kind of deadline counts: what the business set, else the kind's own. */
async function monthsOf(tx: TenantTransaction, key: string, fallback: number): Promise<number> {
  const { rows } = await tx.execute<{ months: number | null }>(
    sql`select ${deadlineSettings.intervalMonths} as months from ${deadlineSettings}
         where ${deadlineSettings.kind} = ${key} limit 1`,
  )
  const kind = coreDeadlineKinds.find((entry) => entry.key === key)

  return rows[0]?.months ?? kind?.intervalMonths ?? fallback
}

/** What the business set that the deletion concept names. */
export async function deletionSettingsOf(tx: TenantTransaction): Promise<DeletionSettings> {
  const switched = await tx.select({ kind: erasureAutomations.kind }).from(erasureAutomations)

  return {
    prospectMonths: await monthsOf(tx, erasureKindWords.prospect.deadline, 12),
    customerMonths: await monthsOf(tx, erasureKindWords.customer.deadline, 36),
    automatic: erasureKinds.filter((kind) => switched.some((row) => row.kind === kind)),
  }
}

/** A document of the kind as it is made now, as Markdown. */
export async function madePrivacyDocument(
  database: Database,
  tx: TenantTransaction,
  kind: PrivacyDocumentKind,
  at: Date,
): Promise<{ readonly markdown: string; readonly keeper: GridParty }> {
  const keeper = await keeperOf(tx)
  const words = atInWords(at)
  const on = berlinClock(at).day as IsoDate

  switch (kind) {
    case 'record':
      return {
        keeper,
        markdown: describeRecord({
          business: keeper.name,
          at: words,
          inputs: await recordInputsOf(tx),
          proposedController: keeper.lines.join('\n'),
          used: await usedActivitiesOf(tx),
        }),
      }
    case 'measures': {
      const instance = await readMeasures(database)

      return {
        keeper,
        markdown: describeMeasures(measuresTemplate(), {
          business: keeper.name,
          at: words,
          measures: instance.measures,
          subprocessors: instance.subprocessors,
          changedAt:
            instance.changedAt === null
              ? null
              : `am ${dayInWords(berlinClock(new Date(instance.changedAt)).day)}`,
        }),
      }
    }
    case 'deletion':
      return {
        keeper,
        markdown: describeDeletion({
          business: keeper.name,
          at: words,
          on,
          settings: await deletionSettingsOf(tx),
        }),
      }
  }
}

/** How the text of a document prints under the head of a sheet. */
const documentStyle = `
.document h2 { font-size: 10pt; margin: 3.5mm 0 1mm; }
.document h3 { font-size: 9.5pt; font-weight: 600; margin: 2.5mm 0 0.8mm; break-after: avoid; }
.document p { margin: 0 0 1.3mm; }
.document ul { margin: 0 0 1.6mm; padding-left: 4.2mm; }
.document li { margin: 0 0 0.8mm; }
.document table { width: 100%; border-collapse: collapse; margin: 0.5mm 0 2mm; font-size: 8pt; }
.document th { text-align: left; font-weight: 600; padding: 0.8mm 1.6mm; border-bottom: 0.6pt solid #1b2430; }
.document td { padding: 0.8mm 1.6mm; border-bottom: 0.3pt solid #d5d9de; vertical-align: top; }
.document tr { break-inside: avoid; }
`

/**
 * A document as the office prints its papers (#319, as the boards draw it):
 * the head with its title, the business and when it was made, then the text
 * after the head the Markdown has of its own, and in the foot title,
 * business and day.
 */
export function privacyPrintJob(
  kind: PrivacyDocumentKind,
  markdown: string,
  keeper: GridParty,
  at: Date,
): PrintJob {
  const title = privacyDocumentTitles[kind]
  const rule = markdown.indexOf('\n---\n')
  const body = rule < 0 ? markdown : markdown.slice(rule + 5)
  const made = `Erzeugt ${atInWords(at)}`
  const footer = `${title}, ${keeper.name}, ${dayInWords(berlinClock(at).day)}`

  return sheetJob(
    title,
    `${sheetHead(title, [keeper.name, made], keeper)}<div class="document">${markdownHtml(body)}</div>`,
    footer,
    documentStyle,
  )
}
