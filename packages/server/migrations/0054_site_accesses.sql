-- The ways into a site, #286: what each opens and a hint in `site_accesses`,
-- the value sealed in `secrets` under the purpose `site_access` and the id of
-- the access, and every showing of a value in `site_access_reveals`.
--
-- `secrets` gets `record_id` for the secrets of one record, and its unique key
-- takes it in, NULLS NOT DISTINCT, so that the mail password stays one per
-- business. The new purpose is added and not used here: all pending
-- migrations run in one transaction, which may not use an enum value it added.
--
-- Everything down to the policies comes from the schema. What follows is
-- written by hand: FORCE and the grants of the two new tables, their audit and
-- sync triggers, the person of a showing, from the request as for working
-- time, and a trigger on `sites` that takes the ways in and their values with
-- a site that is deleted. The application may insert a showing and never
-- change one; of an access it may change what it opens, the hint, when the
-- value was set and that it is deleted.

ALTER TYPE "public"."secret_purpose" ADD VALUE 'site_access';--> statement-breakpoint
CREATE TABLE "site_access_reveals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_access_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"revealed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_access_reveals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_accesses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"hint" text,
	"value_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "site_accesses_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "site_accesses_designation_shaped" CHECK (char_length(btrim("site_accesses"."designation")) between 1 and 60),
	CONSTRAINT "site_accesses_hint_bounded" CHECK ("site_accesses"."hint" is null or char_length("site_accesses"."hint") <= 300)
);
--> statement-breakpoint
ALTER TABLE "site_accesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "secrets" DROP CONSTRAINT "secrets_one_per_purpose";--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "site_access_reveals" ADD CONSTRAINT "site_access_reveals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_access_reveals" ADD CONSTRAINT "site_access_reveals_access_in_tenant" FOREIGN KEY ("tenant_id","site_access_id") REFERENCES "public"."site_accesses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_access_reveals" ADD CONSTRAINT "site_access_reveals_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_accesses" ADD CONSTRAINT "site_accesses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_accesses" ADD CONSTRAINT "site_accesses_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_access_reveals_access_idx" ON "site_access_reveals" USING btree ("tenant_id","site_access_id");--> statement-breakpoint
CREATE INDEX "site_access_reveals_person_idx" ON "site_access_reveals" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "site_accesses_site_idx" ON "site_accesses" USING btree ("tenant_id","site_id");--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_one_per_record" UNIQUE NULLS NOT DISTINCT("tenant_id","purpose","record_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_access_reveals" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("site_access_reveals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("site_access_reveals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_accesses" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("site_accesses"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("site_accesses"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "site_accesses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_access_reveals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "site_accesses" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("designation", "hint", "value_set_at", "deleted_at") ON "site_accesses" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "site_access_reveals" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "site_accesses"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "site_accesses"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "site_access_reveals"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "site_access_reveals"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "site_access_reveals_record_owner" BEFORE INSERT ON "site_access_reveals"
	FOR EACH ROW EXECUTE FUNCTION "record_time_owner"();--> statement-breakpoint

-- A site marked as deleted marks its ways in as well, so that every device
-- hears of it, and forgets their values, as the route does for one access: a
-- code must not outlive the site it opens (Greptile on #445). A trigger and
-- not the route, so that no other way of deleting a site leaves one behind.
-- The accesses first and the values after, each statement with its own
-- snapshot: a value written by a transaction the first one had to wait for
-- is gone as well. The literal of the new purpose is read when the function
-- runs, in a later transaction, not here where the value was added.
CREATE FUNCTION "site_accesses_follow_deletion"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	UPDATE public.site_accesses SET deleted_at = new.deleted_at
	 WHERE tenant_id = new.tenant_id AND site_id = new.id AND deleted_at IS NULL;

	DELETE FROM public.secrets
	 WHERE tenant_id = new.tenant_id
	   AND purpose = 'site_access'
	   AND record_id IN (SELECT id FROM public.site_accesses
	                      WHERE tenant_id = new.tenant_id AND site_id = new.id);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "site_accesses_follow_deletion" AFTER UPDATE OF "deleted_at" ON "sites"
	FOR EACH ROW EXECUTE FUNCTION "site_accesses_follow_deletion"();
