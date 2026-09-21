import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { files } from './files.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * What a business prints at the top and the bottom of its documents. One row
 * per business, which the unique index holds.
 *
 * A table of its own and not columns on `tenants`, although there is exactly
 * one of each. `tenants` is readable from outside a business as far as a
 * person's memberships reach, because the chooser after signing in has to
 * show names; a bank account and a tax number have no business in that list.
 * Here the ordinary isolation applies and nothing else.
 *
 * No sync columns. A device does not change the letterhead in a basement, and
 * a document is printed on the server.
 */
export const letterheads = pgTable(
  'letterheads',
  {
    id: primaryId<'letterhead'>(),
    ...tenantColumn,
    companyName: text('company_name'),

    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country').notNull().default('DE'),

    phone: text('phone'),
    email: text('email'),
    website: text('website'),

    taxNumber: text('tax_number'),
    vatId: text('vat_id'),

    iban: text('iban'),
    bic: text('bic'),
    bankName: text('bank_name'),

    registerCourt: text('register_court'),
    registerNumber: text('register_number'),
    managingDirectors: text('managing_directors'),

    logoFileId: reference<'file'>('logo_file_id').references(() => files.id, {
      onDelete: 'restrict',
    }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('letterheads_tenant').on(table.tenantId),
  ],
)
