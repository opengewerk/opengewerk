import { tagNameMaxLength } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { customers } from './customers.js'
import { tenantIsolation } from './rls.js'
import { sites } from './sites.js'
import { tenantColumn } from './tenants.js'

/**
 * The tags of a business (#314), one row each, for customers and sites alike.
 *
 * Made in the settings or while the office tags a customer or a site, renamed
 * and deleted in the settings, always at a route; a device reads them and
 * writes none. A name stands once per business whatever its case, which the
 * index below holds with `lower()` and `tagKey` in `domain` asks before.
 * Deleting marks the row, so that every device learns of it, and its
 * assignments with it, in the same transaction.
 */
export const tags = pgTable(
  'tags',
  {
    id: primaryId<'tag'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('tags_tenant_id_key').on(table.tenantId, table.id),
    uniqueIndex('tags_name_once')
      .on(table.tenantId, sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    // What `tagNameProblem` and `tagName` ask before anything reaches this
    // table, held here for every other way in.
    check(
      'tags_name_shaped',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) between 1 and ${sql.raw(String(tagNameMaxLength))}`,
    ),
  ],
)

/**
 * A tag on a customer (#314). Set in the office at the route, which takes the
 * whole list of a customer's tags, and removed there by marking the row
 * deleted; the partial index keeps one row that counts per customer and tag.
 */
export const customerTags = pgTable(
  'customer_tags',
  {
    id: primaryId<'customer-tag'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id').notNull(),
    tagId: reference<'tag'>('tag_id').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'customer_tags_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.tagId],
      foreignColumns: [tags.tenantId, tags.id],
      name: 'customer_tags_tag_in_tenant',
    }).onDelete('restrict'),
    uniqueIndex('customer_tags_once')
      .on(table.tenantId, table.customerId, table.tagId)
      .where(sql`${table.deletedAt} is null`),
    index('customer_tags_tag_idx').on(table.tenantId, table.tagId),
  ],
)

/** A tag on a site (#314), in the same way as on a customer. */
export const siteTags = pgTable(
  'site_tags',
  {
    id: primaryId<'site-tag'>(),
    ...tenantColumn,
    siteId: reference<'site'>('site_id').notNull(),
    tagId: reference<'tag'>('tag_id').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'site_tags_site_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.tagId],
      foreignColumns: [tags.tenantId, tags.id],
      name: 'site_tags_tag_in_tenant',
    }).onDelete('restrict'),
    uniqueIndex('site_tags_once')
      .on(table.tenantId, table.siteId, table.tagId)
      .where(sql`${table.deletedAt} is null`),
    index('site_tags_tag_idx').on(table.tenantId, table.tagId),
  ],
)
