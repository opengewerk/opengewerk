import { customerKinds } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import { boolean, check, date, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const customerKind = pgEnum('customer_kind', customerKinds)

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
  ],
)
