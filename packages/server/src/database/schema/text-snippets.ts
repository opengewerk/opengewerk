import { mailOccasions, snippetPurposes } from '@opengewerk/domain'
import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

export const snippetPurpose = pgEnum('snippet_purpose', snippetPurposes)

/** What a snippet for mails is the text of (#315). */
export const mailOccasion = pgEnum('mail_occasion', mailOccasions)

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
    // For a snippet for mails, the occasion it is the text of; one for each.
    mailOccasion: mailOccasion('mail_occasion'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('text_snippets_purpose_idx').on(table.tenantId, table.purpose),
    uniqueIndex('text_snippets_one_per_occasion')
      .on(table.tenantId, table.mailOccasion)
      .where(sql`${table.mailOccasion} is not null`),
  ],
)
