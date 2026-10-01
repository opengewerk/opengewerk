import { supplierLimits } from '@opengewerk/domain'
import { primaryId, syncColumns, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, pgTable, text, unique } from 'drizzle-orm/pg-core'

/**
 * A supplier of the business (#296). Master data like a customer, on every
 * device, and its people are contacts like a customer's. What it sells, and at
 * which price, lives with the articles, in `supplier_articles` and
 * `purchase_prices`, which never travel.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: primaryId<'supplier'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    /** The business's customer number at the supplier. */
    customerNumber: text('customer_number'),
    /** A few capitals an import appends to a number the business already uses (#297). */
    shortCode: text('short_code'),
    email: text('email'),
    phone: text('phone'),

    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country').notNull().default('DE'),

    notes: text('notes'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('suppliers_tenant_id_key').on(table.tenantId, table.id),
    check('suppliers_country_code', sql`${table.country} ~ '^[A-Z]{2}$'`),
    // The limits of `supplierProblems`, which the forms, the routes and the
    // sync ask first, held here for every other way in.
    check(
      'suppliers_name_fits',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(supplierLimits.name))}`,
    ),
    check(
      'suppliers_customer_number_fits',
      sql`char_length(${table.customerNumber}) <= ${sql.raw(String(supplierLimits.customerNumber))}`,
    ),
    check(
      'suppliers_short_code_shaped',
      sql`${table.shortCode} ~ ${sql.raw(`'^[A-ZÄÖÜ0-9]{1,${String(supplierLimits.shortCode)}}$'`)}`,
    ),
  ],
)
