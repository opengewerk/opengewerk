import { UnprocessableEntityException } from '@nestjs/common'
import type { PgTable } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from '../database/database.js'
import { missingReference, missingReferenceText } from '../database/references.js'

/**
 * Refuses a body whose references name nothing of this business, with the
 * field in the sentence.
 *
 * The same question the sync asks, and for the same reasons: the key in the
 * database would refuse a record of another business with a sentence about a
 * constraint, and a record marked as deleted it would take. A 422 and not a
 * 404, because the route is there and so is the record it was asked about;
 * what is not there is what the body points at.
 */
export async function requireReferences(
  tx: TenantTransaction,
  table: PgTable,
  values: Readonly<Record<string, unknown>>,
  creating: boolean,
): Promise<void> {
  const missing = await missingReference(tx, table, values, creating)

  if (missing) {
    throw new UnprocessableEntityException(missingReferenceText(missing))
  }
}
