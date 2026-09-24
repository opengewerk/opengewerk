CREATE TABLE "form_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"definition_version" integer NOT NULL,
	"definition" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "form_definitions_version_positive" CHECK ("form_definitions"."definition_version" > 0),
	CONSTRAINT "form_definitions_bounded" CHECK (char_length("form_definitions"."definition") <= 1000000)
);
--> statement-breakpoint
ALTER TABLE "form_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "fields_version" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "field_values" text;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_definitions_version_once" ON "form_definitions" USING btree ("tenant_id","key","definition_version");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_field_values" CHECK ("documents"."field_values" is null
        or ("documents"."fields_version" > 0
          and char_length("documents"."field_values") <= 1000000));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_definitions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("form_definitions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("form_definitions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "form_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "form_definitions" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "form_definitions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "form_definitions"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- A version of a form, once written, is what every report started with it
-- was filled in and signed against. The application may only insert and read;
-- this refuses a change and a deletion from every role, the owner included.
CREATE FUNCTION "form_definition_stays"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Fassung eines Formulars wird weder geändert noch gelöscht. Eine Änderung ist die nächste Fassung.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "form_definitions_stay" BEFORE UPDATE OR DELETE ON "form_definitions"
	FOR EACH ROW EXECUTE FUNCTION "form_definition_stays"();
