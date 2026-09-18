import type { Id } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import { bigint, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Building blocks only. Nothing here may import a table: the tenant column
// needs `tenants`, and `tenants` needs these blocks, which would close a
// circle that breaks the moment drizzle-kit loads the schema.

/**
 * The primary key of every table. PostgreSQL 18 mints UUIDv7 itself, which
 * covers rows written on the server. A client offline in a basement mints its
 * own and sends it along, and because the value is time ordered the two never
 * collide and the index stays dense (ADR 0003).
 */
export function primaryId<Entity extends string>() {
  return uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)
    .$type<Id<Entity>>()
}

/**
 * A foreign key column. Carries the branded id type of the table it points at,
 * so that a site id cannot end up in a column that wants a customer id.
 */
export function reference<Entity extends string>(name: string) {
  return uuid(name).$type<Id<Entity>>()
}

/** When the row was written and when it last changed. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/**
 * What a record needs in order to survive being changed in two places at once.
 *
 * All five are kept by a trigger, not by whoever writes the row. That is the
 * same reason the audit log has a trigger: a line the application has to
 * remember is a line it forgets at the sixteenth place, and here it would
 * forget it in a way nobody notices, because a stale version only hurts the
 * next time two devices meet.
 *
 * Only the entities that actually travel to a device carry these. A counter
 * row does not, and giving it a `deleted_at` would state something untrue
 * about it.
 */
export const syncColumns = {
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by'),
  deviceId: text('device_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // Zero means "written before this layer existed". The counter hands out one
  // and upwards, so nothing new ever lands on it.
  changeSequence: bigint('change_sequence', { mode: 'number' }).notNull().default(0),
}
