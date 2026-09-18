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
