import {
  defaultPatterns,
  type DocumentKind,
  type NumberRangeKey,
  numberRangeKeys,
  numberRangeOf,
  type TenantId,
} from '@opengewerk/domain'
import {
  numberRangeStore,
  type NumberRangeView as RangeView,
  type TenantTransaction,
} from '@opengewerk/platform-server'

import { yearInGermany } from '../today.js'
import { numberRanges } from './schema/index.js'

/**
 * The numbers of a business: drawn inside the transaction that issues a
 * document or creates a job (#145), shown under "Nummernkreise" and set
 * there. How that is done is the foundation's (`numberRangeStore`, ADR 0010);
 * this binds it to the sequences of this application, the pattern each starts
 * with, both from `domain`, and the year as it is in Germany (#146).
 */
export const { assignNumber, numberRangesOf, changeNumberRange } = numberRangeStore(numberRanges, {
  keys: numberRangeKeys,
  defaultPatterns,
  yearOf: yearInGermany,
})

/** One sequence of a business as the settings show it. */
export type NumberRangeView = RangeView<NumberRangeKey>

/** The next number for a kind of document, from the sequence it belongs to. */
export function assignDocumentNumber(
  tx: TenantTransaction,
  tenantId: TenantId,
  kind: DocumentKind,
  issuedAt: Date,
): Promise<string> {
  return assignNumber(tx, tenantId, numberRangeOf(kind), issuedAt)
}
