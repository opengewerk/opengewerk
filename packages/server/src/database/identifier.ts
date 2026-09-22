import type { Id } from '@opengewerk/domain'
import { uuidv7 } from 'uuidv7'

/**
 * A new key. UUIDv7 so that a technician in a basement can create records
 * without asking the server, and so that the keys still sort by time when the
 * device syncs hours later (ADR 0003).
 *
 * The database mints its own for rows written server side. This is the other
 * half, for rows that arrive with an id already on them. The version the
 * browser uses comes with the offline data layer, and that is where the shared
 * home for this gets decided.
 */
export function newId<Entity extends string>(): Id<Entity> {
  return uuidv7() as Id<Entity>
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether a value can be a key at all. Asked before a value from a request
 * goes into a query: PostgreSQL refuses a malformed uuid with an error that
 * aborts the transaction, and inside a sync run that is every other
 * operation of the transmission as well.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}
