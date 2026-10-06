import { labelCodeAlphabet, labelCodeLength } from '@opengewerk/platform-domain'
import { type SQL, sql } from 'drizzle-orm'
import { check, type PgColumn, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The two columns every table of labels has, whatever its application hangs
 * a label on: the code, and when the label was blocked.
 *
 * The table is the application's, with the keys of its own records, and so is
 * what "one valid label" is counted over. The same everywhere is what these
 * columns promise: the code has its shape (`labelCodeShaped`), stands once in
 * the whole instance (a unique index over the code alone, since the address
 * on a label carries nothing else), and a blocked label stays blocked (the
 * function `keep_label_blocked` of the block `labels.sql`, hung on the table
 * as a trigger `BEFORE UPDATE OF blocked_at`).
 */
export function labelColumns() {
  return {
    code: text('code').notNull(),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
  }
}

/** What `isLabelCode` asks, held in the table for every way in. */
export function labelCodeShaped(name: string, code: PgColumn) {
  return check(
    name,
    sql`${code} ~ ${sql.raw(`'^[${labelCodeAlphabet}]{${String(labelCodeLength)}}$'`)}`,
  )
}

/** A label that still opens something: neither blocked nor deleted. */
export function labelIsValid(blockedAt: PgColumn, deletedAt: PgColumn): SQL {
  return sql`${blockedAt} is null and ${deletedAt} is null`
}
