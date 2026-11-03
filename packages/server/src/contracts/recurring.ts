import { UnprocessableEntityException } from '@nestjs/common'
import {
  type CustomerId,
  type IsoDate,
  lastServiceDay,
  type MaintenanceContractId,
  nextPeriod,
  type PaymentRhythm,
  periodText,
  priceUnitLabel,
  type RenewalKind,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { contentForIssuing, issueWith } from '../api/documents.controller.js'
import { documentLines, documents, maintenanceContracts } from '../database/schema/index.js'
import type { DeadlineRow } from '../deadlines/engine.js'
import { proposedTreatment } from '../documents/treatment.js'

/**
 * The invoice of a period of a maintenance contract paid per period (#295),
 * made when the deadline "Rechnung eines Wartungsvertrags" falls due on the
 * first day of the period: a recurring invoice with the period as the time of
 * service and the flat price as its one line. Dated on the first day of the
 * period, also when it is made later, after a time the instance was down:
 * the rules tax a document by its date, and the rate is the one of the period.
 *
 * The first invoice of a contract waits as a draft, so that somebody looks at
 * it once. After it, a contract that wants it has each one issued at once,
 * by nobody, and the notifications send it to the customer. A period cut
 * short by the end of the contract stays a draft: only the office knows what
 * that part costs. So does an invoice that still lacks something to be
 * issued; the office sees what on its screen.
 *
 * Once per contract and start of a period: the key on the documents holds
 * that, and the deadline moves on to the next period once this one exists.
 */
export async function contractInvoice(tx: TenantTransaction, deadline: DeadlineRow): Promise<void> {
  const [contract] = await tx
    .select()
    .from(maintenanceContracts)
    .where(eq(maintenanceContracts.id, String(deadline.sourceId) as MaintenanceContractId))

  if (!contract || contract.priceKind !== 'flat' || contract.flatCents === null) {
    return
  }

  const terms = {
    startsOn: contract.startsOn as IsoDate,
    termMonths: contract.termMonths,
    renewal: contract.renewal as RenewalKind,
    renewalMonths: contract.renewalMonths,
    noticeMonths: contract.noticeMonths,
    endsOn: contract.endsOn as IsoDate | null,
  }
  const rhythm = contract.paymentRhythm as PaymentRhythm
  const period = nextPeriod(
    { startsOn: terms.startsOn, paymentRhythm: rhythm },
    { lastBilledFrom: null, notBefore: deadline.dueOn as IsoDate, lastDay: lastServiceDay(terms) },
  )

  if (period === null || period.from !== deadline.dueOn) {
    return
  }

  const made = await tx
    .select({ serviceFrom: documents.serviceFrom })
    .from(documents)
    .where(eq(documents.maintenanceContractId, contract.id))

  if (made.some((row) => row.serviceFrom === period.from)) {
    return
  }

  const [created] = await tx
    .insert(documents)
    .values({
      tenantId: contract.tenantId,
      customerId: contract.customerId,
      siteId: contract.siteId,
      kind: 'recurring_invoice',
      documentDate: period.from,
      subject: `${contract.designation}, ${periodText(period)}`,
      serviceFrom: period.from,
      serviceUntil: period.until,
      maintenanceContractId: contract.id,
      taxTreatment: await proposedTreatment(tx, contract.customerId as CustomerId, period.from),
    })
    .returning()

  if (!created) {
    throw new Error('The recurring invoice was written and is not readable afterwards.')
  }

  await tx.insert(documentLines).values({
    tenantId: contract.tenantId,
    documentId: created.id,
    kind: 'item',
    position: 1,
    designation: contract.designation,
    description: `Pauschale ${priceUnitLabel[rhythm]} nach dem Wartungsvertrag ${contract.number}, Leistungszeitraum ${periodText(period)}.`,
    quantityMilli: 1000,
    unit: 'flat_rate',
    unitPriceCents: contract.flatCents,
    vatRate: 'standard',
    netCents: contract.flatCents,
  })

  if (made.length === 0 || !contract.issueByItself || period.cut) {
    return
  }

  const [locked] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, created.id), isNull(documents.deletedAt)))
    .for('update')

  if (!locked) {
    return
  }

  let ready: Awaited<ReturnType<typeof contentForIssuing>>

  try {
    ready = await contentForIssuing(tx, locked)
  } catch (error) {
    // A rule with nothing for the day: the invoice waits as a draft, where the
    // office reads the sentence when it issues it.
    if (error instanceof UnprocessableEntityException) {
      return
    }

    throw error
  }

  if (ready.missing.length === 0) {
    await issueWith(tx, { tenantId: locked.tenantId, userId: null }, locked, ready.content)
  }
}
