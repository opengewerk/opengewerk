import {
  type IsoDate,
  type TenantId,
  type TenantParameter,
  type TenantParameterKey,
  tenantParameterUnits,
} from '@opengewerk/domain'
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'

import type { TenantTransaction } from './database.js'
import { tenantParameters } from './schema/index.js'

/** One day back, on the ISO date scale and without a time zone in sight. */
function theDayBefore(on: IsoDate): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() - 1)

  return at.toISOString().slice(0, 10) as IsoDate
}

/**
 * What a business had set on a given day.
 *
 * Like everything else in this engine it needs the day. An invoice written in
 * 2027 was written by a business that either claimed the small business rule
 * then or did not, and what it claims in 2030 has nothing to do with it.
 */
export async function parameterAt(
  tx: TenantTransaction,
  key: TenantParameterKey,
  on: IsoDate,
): Promise<TenantParameter | null> {
  const [found] = await tx
    .select()
    .from(tenantParameters)
    .where(
      and(
        eq(tenantParameters.key, key),
        lte(tenantParameters.validFrom, on),
        or(isNull(tenantParameters.validUntil), sql`${tenantParameters.validUntil} >= ${on}`),
      ),
    )
    .orderBy(desc(tenantParameters.validFrom))
    .limit(1)

  return found ?? null
}

export class ParameterError extends Error {}

/**
 * Sets a parameter from a day onwards.
 *
 * Nothing is edited. The period that was open is closed the day before, and a
 * new one begins, so that what applied last year keeps applying to last year.
 * Overwriting the row instead would quietly rewrite every invoice that had
 * already been judged by it, which is the exact opposite of what this engine
 * is for.
 */
export async function setParameter(
  tx: TenantTransaction,
  tenantId: TenantId,
  setting: { key: TenantParameterKey; from: IsoDate; value: number; note?: string | null },
): Promise<TenantParameter> {
  const [latest] = await tx
    .select({ validFrom: tenantParameters.validFrom })
    .from(tenantParameters)
    .where(eq(tenantParameters.key, setting.key))
    .orderBy(desc(tenantParameters.validFrom))
    .limit(1)

  if (latest && latest.validFrom >= setting.from) {
    // Forward only. A period slipped in behind an existing one would leave two
    // of them covering the same day, and the answer to "what applied then"
    // would depend on which row came back first. Correcting a past period is a
    // different and much rarer thing, and it should look different.
    throw new ParameterError(
      `Für ${setting.key} gilt bereits ein Wert ab ${latest.validFrom}. Ein neuer Wert kann nur später beginnen.`,
    )
  }

  await tx
    .update(tenantParameters)
    .set({ validUntil: theDayBefore(setting.from) })
    .where(
      and(
        eq(tenantParameters.key, setting.key),
        isNull(tenantParameters.validUntil),
        lte(tenantParameters.validFrom, setting.from),
      ),
    )

  const [written] = await tx
    .insert(tenantParameters)
    .values({
      tenantId,
      key: setting.key,
      validFrom: setting.from,
      unit: tenantParameterUnits[setting.key],
      value: setting.value,
      note: setting.note ?? null,
    })
    .returning()

  if (!written) {
    throw new Error(`The parameter ${setting.key} did not come back`)
  }

  return written
}

/** Everything a business has set, newest period first. */
export function parameterHistory(tx: TenantTransaction) {
  return tx
    .select()
    .from(tenantParameters)
    .orderBy(tenantParameters.key, desc(tenantParameters.validFrom))
}
