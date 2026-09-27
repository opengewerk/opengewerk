-- The tags of a business, #314: words it files customers and sites under,
-- one row each in `tags`, and which customer and which site has which in
-- `customer_tags` and `site_tags`. A name stands once per business whatever
-- its case; a tag deleted is marked, with every row that puts it on a record.
--
-- Everything down to the policies comes from the schema. What follows is
-- written by hand: FORCE and the grants, and the audit and sync triggers of
-- the three new tables. No row of an existing table changes.
--
-- The application may read and insert all three. Of a tag it may change the
-- name and mark it deleted, of an assignment only mark it deleted: tags are
-- made, renamed and deleted at their route, and put on a record at the route
-- of the record.

CREATE TABLE "customer_tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "tags_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tags_name_shaped" CHECK ("tags"."name" = btrim("tags"."name") and char_length("tags"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tag_in_tenant" FOREIGN KEY ("tenant_id","tag_id") REFERENCES "public"."tags"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tags" ADD CONSTRAINT "site_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tags" ADD CONSTRAINT "site_tags_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tags" ADD CONSTRAINT "site_tags_tag_in_tenant" FOREIGN KEY ("tenant_id","tag_id") REFERENCES "public"."tags"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tags_once" ON "customer_tags" USING btree ("tenant_id","customer_id","tag_id") WHERE "customer_tags"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customer_tags_tag_idx" ON "customer_tags" USING btree ("tenant_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_tags_once" ON "site_tags" USING btree ("tenant_id","site_id","tag_id") WHERE "site_tags"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "site_tags_tag_idx" ON "site_tags" USING btree ("tenant_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_once" ON "tags" USING btree ("tenant_id",lower("name")) WHERE "tags"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_tags" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("customer_tags"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("customer_tags"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_tags" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("site_tags"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("site_tags"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tags" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tags"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tags"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "tags" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("name", "deleted_at") ON "tags" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "customer_tags" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("deleted_at") ON "customer_tags" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "site_tags" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("deleted_at") ON "site_tags" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tags"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "tags"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "customer_tags"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "customer_tags"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "site_tags"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "site_tags"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
