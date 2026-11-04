import { customerKinds, prospectSources, reminderGrounds } from '@opengewerk/domain'
import { primaryId, syncColumns, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, date, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

export const customerKind = pgEnum('customer_kind', customerKinds)

export const reminderGround = pgEnum('reminder_ground', reminderGrounds)

/** Where a lead came from (#312), and the customer it became keeps it. */
export const prospectSource = pgEnum('prospect_source', prospectSources)

/**
 * The customer. Tax attributes sit here because they decide how a document has
 * to be written; the rules that read them live in the rule engine, not in the
 * schema.
 */
export const customers = pgTable(
  'customers',
  {
    id: primaryId<'customer'>(),
    ...tenantColumn,
    kind: customerKind('kind').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),

    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country').notNull().default('DE'),

    vatId: text('vat_id'),
    // The Käuferreferenz, for a public authority its Leitweg-ID. Only an
    // XRechnung asks for it, and it cannot go out without it.
    buyerReference: text('buyer_reference'),
    isBusiness: boolean('is_business').notNull().default(false),
    isConstructionServiceRecipient: boolean('is_construction_service_recipient')
      .notNull()
      .default(false),
    taxExemptionCertificateNumber: text('tax_exemption_certificate_number'),
    taxExemptionValidUntil: date('tax_exemption_valid_until'),

    // What reminders of a due inspection or maintenance rest on without a
    // contract (#316), and since when; null for only a contract's.
    reminderGround: reminderGround('reminder_ground'),
    reminderGroundOn: date('reminder_ground_on'),

    // How the customer found the business (#312), from its lead or chosen in
    // the office; null where nobody said.
    source: prospectSource('source'),

    notes: text('notes'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('customers_tenant_id_key').on(table.tenantId, table.id),
    // A code of ISO 3166-1 (#144), what `countryProblem` asks before anything
    // reaches this table, held here for every other way in.
    check('customers_country_code', sql`${table.country} ~ '^[A-Z]{2}$'`),
    // A ground has the day it was given, and none has none (`reminderGroundProblem`).
    check(
      'customers_reminder_ground_on',
      sql`(${table.reminderGround} is null) = (${table.reminderGroundOn} is null)`,
    ),
  ],
)
