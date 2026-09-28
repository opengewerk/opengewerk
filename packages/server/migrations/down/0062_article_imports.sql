-- Takes back 0062. Runs as the superuser, like every down migration.
-- Articles, prices and links an import wrote stay, without the name of their
-- import; the imports themselves, the list prices, the discount groups and the
-- short codes of the suppliers are gone. The triggers of the article tables are
-- what they were before: every change logged and stamped field by field.

DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "article_prices";
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "article_prices"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "articles";
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "articles"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();

DROP TRIGGER IF EXISTS "audit_changes" ON "purchase_prices";
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "purchase_prices"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
DROP TRIGGER IF EXISTS "audit_changes" ON "supplier_articles";
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "supplier_articles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
DROP TRIGGER IF EXISTS "audit_changes" ON "article_prices";
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "article_prices"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
DROP TRIGGER IF EXISTS "audit_changes" ON "articles";
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "articles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();

DROP FUNCTION IF EXISTS "reserve_sync_sequences"(integer);
REVOKE UPDATE ("version", "updated_at", "updated_by", "device_id", "change_sequence") ON "article_prices" FROM "opengewerk_app";

ALTER TABLE "supplier_articles" DROP CONSTRAINT IF EXISTS "supplier_articles_import_in_tenant";
ALTER TABLE "purchase_prices" DROP CONSTRAINT IF EXISTS "purchase_prices_import_in_tenant";
ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_import_in_tenant";
ALTER TABLE "article_prices" DROP CONSTRAINT IF EXISTS "article_prices_import_in_tenant";
DROP INDEX IF EXISTS "articles_ean_idx";
ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_short_code_shaped";
ALTER TABLE "supplier_articles" DROP CONSTRAINT IF EXISTS "supplier_articles_discount_group_fits";
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "short_code";
ALTER TABLE "supplier_articles" DROP COLUMN IF EXISTS "import_id";
ALTER TABLE "supplier_articles" DROP COLUMN IF EXISTS "discount_group";
ALTER TABLE "purchase_prices" DROP COLUMN IF EXISTS "import_id";
ALTER TABLE "articles" DROP COLUMN IF EXISTS "import_id";
ALTER TABLE "article_prices" DROP COLUMN IF EXISTS "import_id";

DROP TABLE IF EXISTS "list_prices";
DROP TABLE IF EXISTS "article_imports";
DROP FUNCTION IF EXISTS "article_import_writing"();
DROP TYPE IF EXISTS "public"."article_import_status";
