-- Takes back 0103 (#461). The search reads the articles again, the table it
-- read instead goes with its triggers and functions, and so do the indexes for
-- the two orders of the list and the extension.
DROP TRIGGER "article_search_on_update" ON "supplier_articles";--> statement-breakpoint
DROP TRIGGER "article_search_on_insert" ON "supplier_articles";--> statement-breakpoint
DROP TRIGGER "article_search_on_update" ON "articles";--> statement-breakpoint
DROP TRIGGER "article_search_on_insert" ON "articles";--> statement-breakpoint
DROP FUNCTION "article_search_hits"(text);--> statement-breakpoint
DROP FUNCTION "article_search_of_supplier_articles"();--> statement-breakpoint
DROP FUNCTION "article_search_of_articles"();--> statement-breakpoint
DROP TABLE "article_search";--> statement-breakpoint
DROP INDEX "articles_designation_order";--> statement-breakpoint
DROP INDEX "articles_number_order";--> statement-breakpoint
DROP EXTENSION "pg_trgm";
