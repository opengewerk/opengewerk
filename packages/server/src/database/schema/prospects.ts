import { prospectLimits, prospectStages } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { customerKind, customers, prospectSource } from './customers.js'
import { sites } from './sites.js'

export const prospectStage = pgEnum('prospect_stage', prospectStages)

/**
 * The leads of the business (#312), called prospects in the code: who asked
 * before there is a customer, with what they want, where they came from and
 * how far the office has qualified them. Becoming a customer fills the
 * customer, the site and the moment, all three at once and never again.
 *
 * No sync columns: the office keeps them at a desk, and a lead goes to no
 * device. Deleted for real while it is no customer, as the deletion concept
 * wants of a lead that never became one (#317); the audit log keeps the
 * deletion.
 */
export const prospects = pgTable(
  'prospects',
  {
    id: primaryId<'prospect'>(),
    ...tenantColumn,
    kind: customerKind('kind').notNull().default('private'),
    name: text('name').notNull(),
    concern: text('concern'),
    email: text('email'),
    phone: text('phone'),
    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country').notNull().default('DE'),
    source: prospectSource('source').notNull(),
    stage: prospectStage('stage').notNull().default('new'),
    lastContactOn: date('last_contact_on').notNull(),
    customerId: reference<'customer'>('customer_id'),
    siteId: reference<'site'>('site_id'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('prospects_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'prospects_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'prospects_site_in_tenant',
    }).onDelete('restrict'),
    check(
      'prospects_texts_fit',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(prospectLimits.name))}
        and char_length(coalesce(${table.concern}, '')) <= ${sql.raw(String(prospectLimits.concern))}`,
    ),
    check('prospects_country_code', sql`${table.country} ~ '^[A-Z]{2}$'`),
    // A customer, its site and the moment come together, and only once
    // (`conversionProblem`); a dismissed lead becomes none.
    check(
      'prospects_converted',
      sql`(${table.customerId} is null) = (${table.convertedAt} is null)
        and (${table.customerId} is null) = (${table.siteId} is null)
        and (${table.customerId} is null or ${table.stage} <> 'dismissed')`,
    ),
    index('prospects_customer_idx').on(table.tenantId, table.customerId),
  ],
)
