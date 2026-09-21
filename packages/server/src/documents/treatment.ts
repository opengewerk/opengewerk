import { type CustomerId, type IsoDate, type TaxTreatment, treatmentFor } from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { parameterAt } from '../database/parameters.js'
import { customers } from '../database/schema/index.js'

/**
 * What treatment a new document should carry, from the two sides that decide
 * it: what the customer is, and what the business claims for itself.
 *
 * Both are read as they stood on the document's date, not as they stand today,
 * because that is the only reading that keeps an old invoice readable. A
 * business that claimed section 19 in 2027 wrote section 19 invoices in 2027,
 * whatever it claims now.
 *
 * A proposal, not a verdict: the field is writable while the document is a
 * draft, because the two flags do not know every case.
 *
 * Asked in two places, and it has to be. A document made in the office comes
 * through the route; one made on site comes through the outbox, and until #73
 * only the route asked. A report written in a cellar for a small business then
 * arrived with the default, and the invoice made out of it would have charged
 * VAT the business may not charge.
 */
export async function proposedTreatment(
  tx: TenantTransaction,
  customerId: CustomerId,
  on: IsoDate,
): Promise<TaxTreatment> {
  const [customer] = await tx
    .select({ construction: customers.isConstructionServiceRecipient })
    .from(customers)
    .where(eq(customers.id, customerId))

  const claimed = await parameterAt(tx, 'small_business.claimed', on)

  return treatmentFor({
    customerIsConstructionServiceRecipient: customer?.construction ?? false,
    businessClaimsSmallBusiness: claimed?.value === 1,
  })
}
