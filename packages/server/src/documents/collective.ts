import {
  continuesChain,
  type DocumentId,
  type IsoDate,
  type JobId,
  noInstructionChoices,
  RuleError,
  type TenantId,
} from '@opengewerk/domain'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import {
  documentInstructionChoices,
  documentLines,
  documents,
  documentSources,
  jobs,
} from '../database/schema/index.js'
import { choicesOf } from './instructions.js'

type DocumentRow = typeof documents.$inferSelect
type LineRow = typeof documentLines.$inferSelect

/** How a report is named where its lines begin on the invoice. */
function reportLabel(report: Pick<DocumentRow, 'number' | 'documentDate'>): string {
  const [year, month, day] = report.documentDate.split('-')

  return `Regiebericht ${report.number ?? ''} vom ${day ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** A line on its way from a report to the invoice, without what the invoice gives it. */
type CopiedLine = Pick<
  LineRow,
  | 'kind'
  | 'designation'
  | 'description'
  | 'quantityMilli'
  | 'unit'
  | 'unitPriceCents'
  | 'vatRate'
  | 'netCents'
>

/**
 * The lines of one report as the invoice carries them: under a title that
 * names the report, so that the invoice says which day each line comes from.
 * A title the report has itself keeps its place and gets the name of the
 * report in front, since a title inside a title is not something the outline
 * of a document has.
 */
function underItsTitle(report: DocumentRow, lines: readonly LineRow[]): CopiedLine[] {
  const label = reportLabel(report)
  const heading: CopiedLine[] =
    lines[0]?.kind === 'title'
      ? []
      : [
          {
            kind: 'title',
            designation: label,
            description: null,
            quantityMilli: 0,
            unit: 'piece',
            unitPriceCents: 0,
            vatRate: 'standard',
            netCents: 0,
          },
        ]

  return [
    ...heading,
    ...lines.map((line) =>
      line.kind === 'title' ? { ...line, designation: `${label}: ${line.designation}` } : line,
    ),
  ]
}

/**
 * The open reports of a job: issued, and neither continued by a successor
 * that counts nor collected in an invoice that counts. Locked, oldest first,
 * so that a successor or a second collective invoice made at the same moment
 * waits and then finds them taken.
 */
async function openReports(tx: TenantTransaction, jobId: JobId): Promise<DocumentRow[]> {
  const reports = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.jobId, jobId),
        eq(documents.kind, 'time_and_material_report'),
        eq(documents.status, 'issued'),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.number), asc(documents.id))
    .for('update')

  if (reports.length === 0) {
    return []
  }

  const ids = reports.map((report) => report.id)
  const continued = new Set(
    (
      await tx
        .select({
          predecessorDocumentId: documents.predecessorDocumentId,
          kind: documents.kind,
          status: documents.status,
        })
        .from(documents)
        .where(and(inArray(documents.predecessorDocumentId, ids), isNull(documents.deletedAt)))
    )
      .filter(continuesChain)
      .map((successor) => successor.predecessorDocumentId),
  )
  const collected = new Set(
    (
      await tx
        .select({ sourceDocumentId: documentSources.sourceDocumentId })
        .from(documentSources)
        .where(
          and(inArray(documentSources.sourceDocumentId, ids), isNull(documentSources.releasedAt)),
        )
    ).map((source) => source.sourceDocumentId),
  )

  return reports.filter((report) => !continued.has(report.id) && !collected.has(report.id))
}

/**
 * Makes the collective invoice of a job (#135): one final invoice over every
 * open report of it, one report for each day of work, section 1.4.
 *
 * On the server and in one transaction, like a successor: the head, the lines
 * of every report and the rows that say which reports it was made out of. The
 * lines are copied, under a title per report, in the order the work was done;
 * prices are put in in the office, as on an invoice out of a single report.
 * The time of the work runs from the first report to the last.
 *
 * Refused, with the sentence, when no report of the job is open, and when the
 * reports are taxed differently: one invoice has one tax treatment. Null for a
 * job that is not there.
 */
export async function makeCollectiveInvoice(
  tx: TenantTransaction,
  tenantId: TenantId,
  jobId: JobId,
  documentDate: IsoDate,
): Promise<DocumentRow | null> {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))

  if (!job) {
    return null
  }

  const reports = await openReports(tx, jobId)
  const [first] = reports

  if (!first) {
    throw new RuleError(
      'Kein Regiebericht dieses Auftrags ist offen. Abgerechnet wird ein festgeschriebener ' +
        'Bericht, und einer, aus dem schon eine Rechnung entstanden ist, kein zweites Mal.',
    )
  }

  if (reports.some((report) => report.taxTreatment !== first.taxTreatment)) {
    throw new RuleError(
      'Die offenen Regieberichte dieses Auftrags sind unterschiedlich besteuert. Eine Rechnung ' +
        'hat einen Steuerfall; die Berichte werden deshalb einzeln abgerechnet.',
    )
  }

  const days = reports.flatMap((report) => [
    report.serviceFrom ?? report.documentDate,
    report.serviceUntil ?? report.serviceFrom ?? report.documentDate,
  ])
  const from = [...days].sort()[0] ?? first.documentDate
  const until = [...days].sort().at(-1) ?? first.documentDate

  const [created] = await tx
    .insert(documents)
    .values({
      tenantId,
      customerId: job.customerId,
      jobId: job.id,
      siteId: job.siteId,
      installationId: job.installationId,
      kind: 'final_invoice',
      documentDate,
      subject: job.designation,
      taxTreatment: first.taxTreatment,
      serviceFrom: from,
      serviceUntil: until === from ? null : until,
    })
    .returning()

  if (!created) {
    throw new Error('The collective invoice was written and is not readable afterwards.')
  }

  // The kind of contract belongs to the work, as on a successor.
  const { variant } = await choicesOf(tx, first.id)

  if (variant !== noInstructionChoices.variant) {
    await tx
      .insert(documentInstructionChoices)
      .values({ tenantId, documentId: created.id, variant })
  }

  const lines = await tx
    .select()
    .from(documentLines)
    .where(
      and(
        inArray(
          documentLines.documentId,
          reports.map((report) => report.id),
        ),
        isNull(documentLines.deletedAt),
      ),
    )
    .orderBy(asc(documentLines.position), asc(documentLines.id))

  const copied = reports.flatMap((report) =>
    underItsTitle(
      report,
      lines.filter((line) => line.documentId === report.id),
    ),
  )

  if (copied.length > 0) {
    await tx.insert(documentLines).values(
      copied.map((line, index) => ({
        tenantId,
        documentId: created.id,
        kind: line.kind,
        position: index + 1,
        designation: line.designation,
        description: line.description,
        quantityMilli: line.quantityMilli,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        vatRate: line.vatRate,
        netCents: line.netCents,
      })),
    )
  }

  await tx.insert(documentSources).values(
    reports.map((report, index) => ({
      tenantId,
      documentId: created.id as DocumentId,
      sourceDocumentId: report.id,
      position: index + 1,
    })),
  )

  return created
}
