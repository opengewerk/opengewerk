import { erasureKinds } from '@opengewerk/domain'
import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { applicationRole, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

export const erasureKind = pgEnum('erasure_kind', erasureKinds)

/**
 * Whether the person of the transaction leads its tenant: a membership of
 * hers, not blocked and not past its last day, with a role that leads. The
 * same question the policy of `audit_redactions` asks (ADR 0013), for the two
 * tables below: what the deletion concept deletes, and whether a kind goes by
 * itself, is for whoever leads the business and for nobody else (#317).
 */
const personLeads = sql`exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date))`

/**
 * The protocol of the deletion concept (#317): one line per record that went,
 * written in the transaction that deleted it.
 *
 * It names nobody, since it outlives what it is about: the kind, the key of
 * the record that went, a label without a name (`prospectErasureLabel`), the
 * day it fell due, whether the pass deleted it by itself and how many values
 * of it the change log blacked out. Who deleted it, or in whose name the pass
 * did, comes from the request (`record_note_author`, as for the notes of a
 * job), and when is `created_at`. Written once: the grant stops at INSERT.
 * It goes to no device.
 */
export const erasures = pgTable(
  'erasures',
  {
    id: primaryId<'erasure'>(),
    ...tenantColumn,
    kind: erasureKind('kind').notNull(),
    // No foreign key: the record is gone, and the line has to outlive it.
    recordId: uuid('record_id').notNull(),
    label: text('label').notNull(),
    dueOn: date('due_on'),
    automatic: boolean('automatic').notNull(),
    redactions: integer('redactions').notNull(),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    pgPolicy('erased_by_whoever_leads', {
      as: 'restrictive',
      for: 'insert',
      to: applicationRole,
      withCheck: personLeads,
    }),
    unique('erasures_tenant_id_key').on(table.tenantId, table.id),
    unique('erasures_once').on(table.tenantId, table.kind, table.recordId),
    check('erasures_label_fits', sql`char_length(${table.label}) between 1 and 200`),
    check('erasures_redactions_counted', sql`${table.redactions} >= 0`),
    index('erasures_time_idx').on(table.tenantId, table.createdAt),
  ],
)

/**
 * The kinds of the deletion concept that go by themselves (#317): a row for
 * each kind somebody who leads the business switched on, with who did it.
 * The pass deletes in that person's name, and only while she leads; switching
 * off deletes the row. Written by whoever leads, as the policy says.
 */
export const erasureAutomations = pgTable(
  'erasure_automations',
  {
    id: primaryId<'erasure-automation'>(),
    ...tenantColumn,
    kind: erasureKind('kind').notNull(),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    pgPolicy('switched_on_by_whoever_leads', {
      as: 'restrictive',
      for: 'insert',
      to: applicationRole,
      withCheck: personLeads,
    }),
    pgPolicy('switched_off_by_whoever_leads', {
      as: 'restrictive',
      for: 'delete',
      to: applicationRole,
      using: personLeads,
    }),
    unique('erasure_automations_tenant_id_key').on(table.tenantId, table.id),
    unique('erasure_automations_once').on(table.tenantId, table.kind),
  ],
)
