import { type IsoDate, type JobId, visitDescription } from '@opengewerk/domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { jobs, maintenanceContracts } from '../database/schema/index.js'

/** The one line of an invoice out of the reports of a maintenance at a flat price. */
export interface ContractFlatLine {
  readonly kind: 'item'
  readonly designation: string
  readonly description: string
  readonly quantityMilli: number
  readonly unit: 'flat_rate'
  readonly unitPriceCents: number
  readonly vatRate: 'standard'
  readonly netCents: number
}

/**
 * The line of the invoice out of the reports of a maintenance (#294) whose
 * contract has a flat price per maintenance, or null: for a job no contract
 * made, for a contract at effort, whose invoice comes out of the report as
 * usual, and for one paid per period, which the recurring invoice bills.
 *
 * The flat price takes the place of the lines of the report: the services it
 * covers are what the report writes down. What came on top the office adds
 * to the draft, which is what an invoice out of a report is until it is
 * issued.
 */
export async function contractFlatLineFor(
  tx: TenantTransaction,
  jobId: string | null,
): Promise<ContractFlatLine | null> {
  if (jobId === null || !isUuid(jobId)) {
    return null
  }

  const [found] = await tx
    .select({
      dueOn: jobs.maintenanceDueOn,
      number: maintenanceContracts.number,
      designation: maintenanceContracts.designation,
      services: maintenanceContracts.services,
      priceKind: maintenanceContracts.priceKind,
      flatCents: maintenanceContracts.flatCents,
      paymentRhythm: maintenanceContracts.paymentRhythm,
    })
    .from(jobs)
    .innerJoin(maintenanceContracts, eq(maintenanceContracts.id, jobs.maintenanceContractId))
    .where(eq(jobs.id, jobId as JobId))

  if (
    !found ||
    found.dueOn === null ||
    found.priceKind !== 'flat' ||
    found.flatCents === null ||
    found.paymentRhythm !== 'visit'
  ) {
    return null
  }

  return {
    kind: 'item',
    designation: found.designation,
    description: visitDescription(found, found.dueOn as IsoDate),
    quantityMilli: 1000,
    unit: 'flat_rate',
    unitPriceCents: found.flatCents,
    vatRate: 'standard',
    netCents: found.flatCents,
  }
}
