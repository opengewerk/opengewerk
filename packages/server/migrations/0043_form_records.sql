CREATE TYPE "public"."form_record_status" AS ENUM('draft', 'signed');--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'kiloohms';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'milliseconds';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'volts';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'factor';--> statement-breakpoint
CREATE TABLE "form_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_key" text NOT NULL,
	"definition_version" integer NOT NULL,
	"installation_id" uuid NOT NULL,
	"job_id" uuid,
	"performed_on" date NOT NULL,
	"status" "form_record_status" DEFAULT 'draft' NOT NULL,
	"values" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "form_records_version_positive" CHECK ("form_records"."definition_version" > 0),
	CONSTRAINT "form_records_values_bounded" CHECK (char_length("form_records"."values") <= 1000000)
);
--> statement-breakpoint
ALTER TABLE "form_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_records_installation_idx" ON "form_records" USING btree ("tenant_id","installation_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_records" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("form_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("form_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "form_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "form_records" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "form_records"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "form_records"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- A signed protocol says what the tester signed, and keeps saying it. The
-- gate of the sync policy refuses a change from a device before it is
-- queued; this refuses every other way in, a route written later included.
-- Marking one deleted is a change like any other: a test that was signed
-- took place.
CREATE FUNCTION "form_record_stays_signed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.status = 'signed' THEN
		RAISE EXCEPTION 'Ein unterschriebenes Protokoll wird nicht mehr geändert. Eine neue Prüfung ist ein neues Protokoll.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "form_records_stay_signed" BEFORE UPDATE ON "form_records"
	FOR EACH ROW EXECUTE FUNCTION "form_record_stays_signed"();
