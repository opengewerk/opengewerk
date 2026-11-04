-- Takes back 0126 (#312). A lead is somebody who asked, and the source of a
-- customer is what the office was told: this rollback deletes neither. While
-- there is a lead or a customer with a source, it stops. Which they are, this
-- shows:
--
--   select id, name, stage from prospects;
--   select id, name, source from customers where source is not null;
--
-- The rights `prospect.read` and `prospect.write` leave every role that has
-- them.

DO $$
BEGIN
	ALTER TABLE "prospects" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "customers" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "prospects")
		OR EXISTS (SELECT 1 FROM "customers" WHERE "source" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt schon Leads oder Kunden mit einer Quelle. Die Rücknahme von 0126 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "prospects" FORCE ROW LEVEL SECURITY;
	ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
END
$$;

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;
SELECT set_config('app.reason', 'migration', true);
UPDATE "tenant_roles" SET "rights" = array_remove(array_remove("rights", 'prospect.read'), 'prospect.write')
 WHERE 'prospect.read' = ANY ("rights") OR 'prospect.write' = ANY ("rights");
SELECT set_config('app.reason', '', true);
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;

DROP TABLE "prospects";
ALTER TABLE "customers" DROP COLUMN "source";
DROP TYPE "public"."prospect_stage";
DROP TYPE "public"."prospect_source";
