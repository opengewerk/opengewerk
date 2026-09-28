import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { customers } from './customers.js'
import { sites } from './sites.js'
import { suppliers } from './suppliers.js'

/**
 * A person to talk to. Hangs off a customer, off a single site or, since
 * #296, off a supplier, and the check makes sure it is exactly one: a contact
 * that belongs to nothing is unreachable, one that belongs to two is ambiguous
 * when a site changes hands.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: primaryId<'contact'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id'),
    siteId: reference<'site'>('site_id'),
    supplierId: reference<'supplier'>('supplier_id'),
    givenName: text('given_name'),
    familyName: text('family_name').notNull(),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'contacts_customer_in_tenant',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'contacts_site_in_tenant',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'contacts_supplier_in_tenant',
    }).onDelete('cascade'),
    check(
      'contacts_belong_to_one_parent',
      sql`num_nonnulls(${table.customerId}, ${table.siteId}, ${table.supplierId}) = 1`,
    ),
    index('contacts_customer_idx').on(table.tenantId, table.customerId),
    index('contacts_site_idx').on(table.tenantId, table.siteId),
    index('contacts_supplier_idx').on(table.tenantId, table.supplierId),
  ],
)
