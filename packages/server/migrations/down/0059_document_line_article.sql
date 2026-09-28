-- Takes back 0059. Runs as the superuser, like every down migration.

DROP INDEX IF EXISTS "document_lines_recent_articles_idx";
DROP INDEX IF EXISTS "document_lines_article_idx";
ALTER TABLE "document_lines" DROP CONSTRAINT IF EXISTS "document_lines_article_in_tenant";
ALTER TABLE "document_lines" DROP COLUMN IF EXISTS "article_id";
