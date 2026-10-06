import { numberFromPattern, patternProblem, type TenantId } from '@opengewerk/platform-domain'
import { and, eq, sql } from 'drizzle-orm'

import type { TenantTransaction } from './database.js'
import type { NumberRangesTable } from './schema/number-ranges.js'

/** What an application says about its sequences beyond their keys. */
export interface NumberRangeLists<Key extends string> {
  /** Every sequence of the application, in the order its settings show them. */
  readonly keys: readonly Key[]
  /** The pattern each sequence starts with, until a tenant sets its own. */
  readonly defaultPatterns: Readonly<Record<Key, string>>
  /**
   * The year a moment falls in, where the tenants of the application are.
   *
   * Not `getFullYear`: that answers in the time zone of the process, and a
   * container runs in UTC unless somebody sets `TZ`. Which time zone it is
   * instead, the application knows.
   */
  readonly yearOf: (moment: Date) => number
}

/** One sequence as the settings show it. */
export interface NumberRangeView<Key extends string = string> {
  readonly key: Key
  readonly pattern: string
  /** The counter the next number gets. */
  readonly nextValue: number
  /** What the next number would be, drawn now. */
  readonly next: string
}

/** How many numbers one step hands out at most: far more than any list that is taken over holds. */
const mostAtOnce = 100_000

/** A change to a sequence that is not made, with the sentence saying why. */
export class NumberRangeRefused extends Error {}

/** The sequences of the tenants of one application: numbers drawn, shown and set. */
export interface NumberRangeStore<Key extends string> {
  /**
   * Hands out the next number of a sequence, inside the transaction that
   * needs it.
   *
   * The counter sits in a row, not in a sequence, and the `update` takes a
   * lock on that row until the transaction ends. Two requests arriving
   * together are therefore served one after the other, and a request that
   * fails afterwards takes its number back with it, because the same rollback
   * undoes both. That is what keeps the sequence free of holes, and it is
   * exactly what a sequence cannot do: a sequence hands out its value outside
   * the transaction and keeps it when the transaction rolls back.
   *
   * The year comes from the moment the number is drawn, not from a date the
   * record carries. The numbers then run in the order they were handed out,
   * which is the order somebody checking them walks them in.
   */
  assignNumber(tx: TenantTransaction, tenantId: TenantId, key: Key, at: Date): Promise<string>
  /**
   * Hands out the next numbers of a sequence in one step, as many as asked
   * for and in their order.
   *
   * For what makes many records at once, a list that is taken over. The
   * counter moves on by the count in one statement: the row is locked once,
   * and the audit log holds one change of the counter, not one per record.
   * Like a single number, they go back with the transaction that drew them.
   * No number is asked for and none is drawn: then nothing is written.
   */
  assignNumbers(
    tx: TenantTransaction,
    tenantId: TenantId,
    key: Key,
    at: Date,
    count: number,
  ): Promise<string[]>
  /**
   * Every sequence of a tenant, the ones nothing has drawn from yet included:
   * a range is created on first use, and until then its pattern is the
   * default.
   */
  numberRangesOf(
    tx: TenantTransaction,
    tenantId: TenantId,
    now?: Date,
  ): Promise<NumberRangeView<Key>[]>
  /**
   * Changes the pattern of a sequence, and moves its counter on when asked.
   *
   * The new pattern applies from the next number; numbers already handed out
   * stay what they are, and the audit log keeps the old pattern. The counter
   * only ever moves forward. A tenant that comes from another program
   * continues its sequence by setting the next number, and a number lower
   * than the next one would hand out again what a record already carries.
   *
   * The row is locked for the change, like it is for drawing. A number drawn
   * at the same moment waits, or the change does, and neither sees half of
   * the other.
   */
  changeNumberRange(
    tx: TenantTransaction,
    tenantId: TenantId,
    key: Key,
    wanted: { readonly pattern: string; readonly nextValue?: number },
    now?: Date,
  ): Promise<NumberRangeView<Key>>
}

/**
 * The store over the table an application made with `numberRangesSchema`.
 *
 * A default pattern that is no pattern is refused here, when the application
 * starts, and not when the first number of that sequence is drawn: by then a
 * record would be waiting for it.
 */
export function numberRangeStore<const Key extends string>(
  table: NumberRangesTable<Key>,
  lists: NumberRangeLists<Key>,
): NumberRangeStore<Key> {
  for (const key of lists.keys) {
    const problem = patternProblem(lists.defaultPatterns[key])

    if (problem !== null) {
      throw new Error(`The default pattern of the number range ${key} is not one: ${problem}`)
    }
  }

  // The statements are the same whatever the sequences are called. Written
  // once against the table with any key, which is what the database sees as
  // well: an enum, and a value of it.
  const numberRanges = table as unknown as NumberRangesTable
  const { defaultPatterns, yearOf } = lists

  const viewOf = (
    key: Key,
    pattern: string,
    nextValue: number,
    now: Date,
  ): NumberRangeView<Key> => ({
    key,
    pattern,
    nextValue,
    next: numberFromPattern(pattern, { counter: nextValue, year: yearOf(now) }),
  })

  /**
   * The range is created on first use. Doing it when a tenant is created
   * would mean every new range needs a migration over existing tenants.
   */
  const ensure = (tx: TenantTransaction, tenantId: TenantId, key: Key) =>
    tx
      .insert(numberRanges)
      .values({ tenantId, key, pattern: defaultPatterns[key] })
      .onConflictDoNothing()

  /** Moves the counter on by `count` in one statement, and gives the numbers it passed. */
  const draw = async (
    tx: TenantTransaction,
    tenantId: TenantId,
    key: Key,
    at: Date,
    count: number,
  ): Promise<string[]> => {
    if (!Number.isInteger(count) || count < 1 || count > mostAtOnce) {
      throw new Error(
        `Numbers are drawn one at least and ${String(mostAtOnce)} at most at once, not ${String(count)}`,
      )
    }

    await ensure(tx, tenantId, key)

    const [range] = await tx
      .update(numberRanges)
      .set({ nextValue: sql`${numberRanges.nextValue} + ${count}`, updatedAt: new Date() })
      .where(and(eq(numberRanges.tenantId, tenantId), eq(numberRanges.key, key)))
      .returning()

    if (!range) {
      throw new Error(`No number range for ${key}`)
    }

    // `returning` gives the new value, so the first one handed out is `count` less.
    const first = range.nextValue - count
    const year = yearOf(at)

    return Array.from({ length: count }, (_, index) =>
      numberFromPattern(range.pattern, { counter: first + index, year }),
    )
  }

  return {
    async assignNumber(tx, tenantId, key, at) {
      const [number] = await draw(tx, tenantId, key, at, 1)

      if (number === undefined) {
        throw new Error(`No number range for ${key}`)
      }

      return number
    },

    async assignNumbers(tx, tenantId, key, at, count) {
      return count === 0 ? [] : draw(tx, tenantId, key, at, count)
    },

    async numberRangesOf(tx, tenantId, now = new Date()) {
      const rows = await tx.select().from(numberRanges).where(eq(numberRanges.tenantId, tenantId))
      const byKey = new Map(rows.map((row) => [row.key, row]))

      return lists.keys.map((key) => {
        const row = byKey.get(key)

        return viewOf(key, row?.pattern ?? defaultPatterns[key], row?.nextValue ?? 1, now)
      })
    },

    async changeNumberRange(tx, tenantId, key, wanted, now = new Date()) {
      const problem = patternProblem(wanted.pattern)

      if (problem !== null) {
        throw new NumberRangeRefused(problem)
      }

      await ensure(tx, tenantId, key)

      const [current] = await tx
        .select()
        .from(numberRanges)
        .where(and(eq(numberRanges.tenantId, tenantId), eq(numberRanges.key, key)))
        .for('update')

      if (!current) {
        throw new Error(`No number range for ${key}`)
      }

      const nextValue = wanted.nextValue ?? current.nextValue

      if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 999_999_999) {
        throw new NumberRangeRefused('Die nächste Nummer ist eine ganze Zahl ab 1.')
      }

      if (nextValue < current.nextValue) {
        throw new NumberRangeRefused(
          `Die nächste Nummer kann nur steigen. Bis ${String(current.nextValue - 1)} ist schon ` +
            'vergeben, darunter käme eine Nummer ein zweites Mal vor.',
        )
      }

      const [row] = await tx
        .update(numberRanges)
        .set({ pattern: wanted.pattern, nextValue, updatedAt: new Date() })
        .where(and(eq(numberRanges.tenantId, tenantId), eq(numberRanges.key, key)))
        .returning()

      if (!row) {
        throw new Error(`No number range for ${key}`)
      }

      return viewOf(key, row.pattern, row.nextValue, now)
    },
  }
}
