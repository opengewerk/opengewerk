import type { Id, IsoDate, TenantId } from '@opengewerk/platform-domain'
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'

import type { TenantTransaction } from './database.js'
import type { TenantParametersTable } from './schema/parameters.js'

/** One setting of a tenant, for the time it applied. */
export interface TenantParameterRow<Key extends string = string, Unit extends string = string> {
  readonly id: Id<'tenant-parameter'>
  readonly tenantId: TenantId
  readonly key: Key
  readonly validFrom: IsoDate
  readonly validUntil: IsoDate | null
  readonly unit: Unit
  readonly value: number
  readonly note: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** What an application says about its settings beyond their keys. */
export interface TenantParameterLists<Key extends string, Unit extends string> {
  /**
   * What each setting is called in a sentence, after "für": "Für das
   * Zahlungsziel gilt bereits ein Wert ab ...". A refusal a person reads names
   * the setting as the screen does, never by its key.
   */
  readonly names: Readonly<Record<Key, string>>
  /** The unit the value of each setting is counted in. */
  readonly units: Readonly<Record<Key, Unit>>
  /**
   * What is wrong with a value for a setting, as a sentence for the screen,
   * or null when nothing is.
   *
   * Asked before anything is written, whichever way the value came in. A
   * setting ends up in what an application calculates and decides, so it is
   * checked where it is kept and not only by the form that usually sends it.
   * That a value is a whole number the store asks itself; what a number has
   * to be for this setting, only the application knows.
   */
  readonly problemOf: (key: Key, value: number) => string | null
}

/** A setting that is not written, with the sentence saying why. */
export class ParameterError extends Error {}

/** The settings of the tenants of one application, read for a day and written from a day on. */
export interface TenantParameterStore<Key extends string, Unit extends string> {
  /**
   * What a tenant had set on a given day.
   *
   * Like everything else that is judged by a setting it needs the day.
   * Something written in one year was written by a tenant that had set this
   * then or had not, and what it sets three years later has nothing to do
   * with it.
   */
  parameterAt(
    tx: TenantTransaction,
    key: Key,
    on: IsoDate,
  ): Promise<TenantParameterRow<Key, Unit> | null>
  /**
   * Sets a parameter from a day onwards.
   *
   * Nothing is edited. The period that was open is closed the day before, and
   * a new one begins, so that what applied last year keeps applying to last
   * year. Overwriting the row instead would quietly rewrite everything that
   * had already been judged by it.
   */
  setParameter(
    tx: TenantTransaction,
    tenantId: TenantId,
    setting: { key: Key; from: IsoDate; value: number; note?: string | null },
  ): Promise<TenantParameterRow<Key, Unit>>
  /** Everything a tenant has set, by setting, newest period first. */
  parameterHistory(tx: TenantTransaction): Promise<TenantParameterRow<Key, Unit>[]>
}

/** What the column of the value takes: a whole number of four bytes. */
const largestValue = 2_147_483_647

/** An ISO day as a person in Germany writes it: 2026-01-01 is 01.01.2026. */
function germanDay(on: string): string {
  const [year, month, day] = on.split('-')

  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** One day back, on the ISO date scale and without a time zone in sight. */
function theDayBefore(on: IsoDate): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() - 1)

  return at.toISOString().slice(0, 10) as IsoDate
}

/**
 * The store over the table an application made with `tenantParametersSchema`.
 *
 * Every question is asked inside the transaction of a tenant, and the tenant
 * is not named again in it: row level security is what keeps the settings of
 * one tenant from another, here as everywhere.
 */
export function tenantParameterStore<const Key extends string, const Unit extends string>(
  table: TenantParametersTable<Key, Unit>,
  lists: TenantParameterLists<Key, Unit>,
): TenantParameterStore<Key, Unit> {
  // The statements are the same whatever the settings are called. Written
  // once against the table with any key, which is what the database sees as
  // well: two enums, and a value of each.
  const tenantParameters = table as unknown as TenantParametersTable
  type Row = TenantParameterRow<Key, Unit>

  return {
    async parameterAt(tx, key, on) {
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

      return (found as Row | undefined) ?? null
    },

    async setParameter(tx, tenantId, setting) {
      // Whole numbers, and a flag is a zero or a one. Said here in a sentence,
      // because the column would say it with an error nobody can read.
      if (!Number.isInteger(setting.value) || Math.abs(setting.value) > largestValue) {
        throw new ParameterError('Der Wert einer Einstellung ist eine ganze Zahl.')
      }

      const problem = lists.problemOf(setting.key, setting.value)

      if (problem !== null) {
        throw new ParameterError(problem)
      }

      const [latest] = await tx
        .select({ validFrom: tenantParameters.validFrom })
        .from(tenantParameters)
        .where(eq(tenantParameters.key, setting.key))
        .orderBy(desc(tenantParameters.validFrom))
        .limit(1)

      if (latest && latest.validFrom >= setting.from) {
        // Forward only. A period slipped in behind an existing one would leave
        // two of them covering the same day, and the answer to "what applied
        // then" would depend on which row came back first. Correcting a past
        // period is a different and much rarer thing, and it should look
        // different.
        throw new ParameterError(
          `Für ${lists.names[setting.key]} gilt bereits ein Wert ab ${germanDay(latest.validFrom)}. Ein neuer Wert kann nur später beginnen.`,
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
          unit: lists.units[setting.key],
          value: setting.value,
          note: setting.note ?? null,
        })
        .returning()

      if (!written) {
        throw new Error(`The parameter ${setting.key} did not come back`)
      }

      return written as Row
    },

    async parameterHistory(tx) {
      const rows = await tx
        .select()
        .from(tenantParameters)
        .orderBy(tenantParameters.key, desc(tenantParameters.validFrom))

      return rows as Row[]
    },
  }
}
