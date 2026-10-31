import { reference, tenantIsolation } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { supplierArticles } from './articles.js'
import { articles } from './stock.js'

/**
 * What the search over the catalogue reads (#461): one row for each article
 * with its number, name and EAN, and one for each supplier's number of it,
 * in lower case, under a trigram index.
 *
 * The one table of this application outside FORCE, decided by Moritz on
 * 30.10.2026 (ADR 0015). Under row level security PostgreSQL takes an index
 * only for a comparison it knows to be leakproof, and LIKE is not one, so the
 * same index on `articles` would never be used: every search read the whole
 * catalogue. The application has no right on this table at all. It is written
 * by the triggers of `articles` and `supplier_articles`, which run as the
 * owner, and read only through `article_search_hits`, which asks for the
 * tenant of the transaction itself. Nothing in it is new: each row repeats
 * what its article or link says.
 *
 * The key is the row it repeats, the article's or the link's, so a trigger
 * finds its row again without asking which kind it is.
 */
export const articleSearch = pgTable(
  'article_search',
  {
    id: uuid('id').primaryKey(),
    ...tenantColumn,
    articleId: reference<'article'>('article_id').notNull(),
    /** Set on the row of a supplier's number, null on the article's own. */
    supplierArticleId: reference<'supplier-article'>('supplier_article_id'),
    text: text('text').notNull(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('article_search_text').using('gin', table.text.op('gin_trgm_ops')),
    index('article_search_article').on(table.tenantId, table.articleId),
    index('article_search_link').on(table.tenantId, table.supplierArticleId),
    foreignKey({
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
      name: 'article_search_article_in_tenant',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.supplierArticleId],
      foreignColumns: [supplierArticles.tenantId, supplierArticles.id],
      name: 'article_search_link_in_tenant',
    }).onDelete('cascade'),
  ],
)
