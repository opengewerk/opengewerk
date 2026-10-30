-- The people at a customer or a site go with it (#555).
--
-- A supplier marked as deleted marks its contacts as well, by the trigger of
-- 0058. A customer and a site did not: `DELETE /customers/:id` and
-- `DELETE /sites/:id` took their tags along and left the contacts standing.
-- `GET /contacts` kept delivering them, and a device that held one never heard
-- that it should let it go, because nothing changed on the row: names, phone
-- numbers and addresses of people, hanging on nothing anybody sees.
--
-- A trigger and not the routes, as for the ways into a site (0054), so that no
-- other way of deleting a customer or a site leaves one behind. What a contact
-- hangs on is this application's (`contactsSchema`, ADR 0010), and so is what
-- follows it; the foundation says nothing about it.
--
-- The contacts of customers and sites deleted before this migration are marked
-- now, with the moment of their parent, and every device hears of it at its
-- next exchange. Row level security is lifted on the three tables for that
-- statement: an installation migrates as the owner, and under FORCE the owner
-- finds no row and says nothing (0029, 0095). The change log names the
-- migration as the reason.
--
-- **Fits the version before it**: it never deleted a contact and reads them as
-- before. A customer it deletes takes its contacts along from now on, as with
-- this version.
CREATE FUNCTION "contacts_follow_deletion"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	-- Every statement names the business as well, like the triggers of 0030,
	-- 0054 and 0058.
	IF tg_table_name = 'customers' THEN
		UPDATE public.contacts SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND customer_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'sites' THEN
		UPDATE public.contacts SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND site_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contacts_follow_deletion" AFTER UPDATE OF "deleted_at" ON "customers"
	FOR EACH ROW EXECUTE FUNCTION "contacts_follow_deletion"();--> statement-breakpoint
CREATE TRIGGER "contacts_follow_deletion" AFTER UPDATE OF "deleted_at" ON "sites"
	FOR EACH ROW EXECUTE FUNCTION "contacts_follow_deletion"();--> statement-breakpoint
ALTER TABLE "contacts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "contacts" SET "deleted_at" = "parent"."deleted_at"
	FROM (
		SELECT "tenant_id", "id" AS "customer_id", NULL::uuid AS "site_id", "deleted_at"
		  FROM "customers" WHERE "deleted_at" IS NOT NULL
		UNION ALL
		SELECT "tenant_id", NULL::uuid, "id", "deleted_at"
		  FROM "sites" WHERE "deleted_at" IS NOT NULL
	) AS "parent"
	WHERE "contacts"."deleted_at" IS NULL
	AND "contacts"."tenant_id" = "parent"."tenant_id"
	AND ("contacts"."customer_id" = "parent"."customer_id" OR "contacts"."site_id" = "parent"."site_id");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "sites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
