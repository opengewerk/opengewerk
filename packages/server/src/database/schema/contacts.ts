import { contactsSchema, reference } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index } from 'drizzle-orm/pg-core'

import { customers } from './customers.js'
import { sites } from './sites.js'
import { suppliers } from './suppliers.js'

/** What a contact of this application hangs on: a customer, a site or a supplier. */
const contactParents = {
  customerId: reference<'customer'>('customer_id'),
  siteId: reference<'site'>('site_id'),
  supplierId: reference<'supplier'>('supplier_id'),
}

/** The columns this application gives its contacts. */
export type ContactParentColumns = typeof contactParents

/**
 * A person to talk to. Hangs off a customer, off a single site or, since
 * #296, off a supplier, and the check makes sure it is exactly one: a contact
 * that belongs to nothing is unreachable, one that belongs to two is ambiguous
 * when a site changes hands.
 *
 * The table is the foundation's (`contactsSchema`,
 * opengewerk-haustechnik#85): who a contact is and how to reach them, the sync
 * columns and the separation of the businesses. Kept here are the three
 * parents with their keys over the business, the check and the indexes.
 */
export const { contacts } = contactsSchema({
  columns: contactParents,
  constraints: (table) => [
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
})
