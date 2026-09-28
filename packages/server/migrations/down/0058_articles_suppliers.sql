-- Takes back 0058. Runs as the superuser, like every down migration, so that
-- no policy hides a row. The contacts of suppliers go first: without their
-- column they would hang on nothing, and the old check would refuse them.

DROP TRIGGER IF EXISTS "material_follows_deletion" ON "suppliers";
DROP TRIGGER IF EXISTS "material_follows_deletion" ON "articles";
DROP FUNCTION IF EXISTS "material_follows_deletion"();
DELETE FROM "contacts" WHERE "supplier_id" IS NOT NULL;
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_belong_to_one_parent";
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_supplier_in_tenant";
DROP INDEX IF EXISTS "contacts_supplier_idx";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "supplier_id";
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_belong_to_customer_or_site" CHECK (("contacts"."customer_id" is null) <> ("contacts"."site_id" is null));
DROP TABLE IF EXISTS "purchase_prices";
DROP TABLE IF EXISTS "supplier_articles";
DROP TABLE IF EXISTS "article_prices";
DROP TABLE IF EXISTS "articles";
DROP TABLE IF EXISTS "suppliers";
