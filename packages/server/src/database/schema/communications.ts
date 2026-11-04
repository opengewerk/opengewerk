import { callDirections, communicationKinds, communicationLimits } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { customers } from './customers.js'
import { sites } from './sites.js'

export const communicationKind = pgEnum('communication_kind', communicationKinds)

export const callDirection = pgEnum('call_direction', callDirections)

/**
 * The notes and calls at a customer and at a site (#313), one per row: what
 * was said or noted, who wrote it and when it was.
 *
 * Written once and never changed, like the notes of a job (#220): the grant
 * stops at INSERT, so a wrong entry is followed by another one rather than
 * rewritten. `created_by` is written by the trigger of the notes from the
 * request and carries no key, as there. No sync columns: the office keeps
 * the history at a desk, and it goes to no device.
 */
export const communications = pgTable(
  'communications',
  {
    id: primaryId<'communication'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id').notNull(),
    siteId: reference<'site'>('site_id'),
    kind: communicationKind('kind').notNull(),
    direction: callDirection('direction'),
    counterpart: text('counterpart'),
    text: text('text').notNull(),
    happenedAt: timestamp('happened_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('communications_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'communications_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'communications_site_in_tenant',
    }).onDelete('restrict'),
    // A call has its direction, a note has neither direction nor counterpart
    // (`communicationProblems`).
    check(
      'communications_kind_fits',
      sql`(${table.kind} = 'call') = (${table.direction} is not null)
        and (${table.kind} = 'call' or ${table.counterpart} is null)`,
    ),
    check(
      'communications_texts_fit',
      sql`char_length(${table.text}) between 1 and ${sql.raw(String(communicationLimits.text))}
        and char_length(coalesce(${table.counterpart}, '')) <= ${sql.raw(String(communicationLimits.counterpart))}`,
    ),
    index('communications_customer_idx').on(table.tenantId, table.customerId, table.happenedAt),
    index('communications_site_idx').on(table.tenantId, table.siteId, table.happenedAt),
  ],
)
