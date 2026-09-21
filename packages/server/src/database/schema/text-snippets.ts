import { snippetPurposes } from '@opengewerk/domain'
import { index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const snippetPurpose = pgEnum('snippet_purpose', snippetPurposes)

/**
 * The texts a business writes once and puts into its documents again and
 * again: the description of a service, the opening and closing sentences of
 * a quote.
 *
 * No sync columns. The office picks from them at a desk, and inserting one
 * copies its text into the document, which does travel. A device in a cellar
 * that needed the list would get it with the issue that brings documents to
 * the site, together with the question which of them it needs.
 *
 * Deleted for real, not marked. A snippet is a writing aid and not a record of
 * anything; every document that used it holds its own copy of the text, and
 * the audit log keeps the deletion.
 */
export const textSnippets = pgTable(
  'text_snippets',
  {
    id: primaryId<'text-snippet'>(),
    ...tenantColumn,
    purpose: snippetPurpose('purpose').notNull(),
    title: text('title').notNull(),
    text: text('text').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('text_snippets_purpose_idx').on(table.tenantId, table.purpose),
  ],
)
