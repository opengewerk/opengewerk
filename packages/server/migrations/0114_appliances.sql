-- The register of appliances and their test after DGUV Vorschrift 3 (#303,
-- Feature-Gliederung v2.51).
--
-- **The new table** `appliances`: what hangs on no circuit at a site, the
-- drill, the coffee machine, the extension lead, with its protection class,
-- whether it is portable or fixed and the length of its lead. It carries the
-- columns of the sync and travels to the devices, which make and change it;
-- nothing is removed, a row is taken out by marking it.
--
-- **A protocol hangs on an installation or on an appliance**: `form_records`
-- gains `appliance_id`, `installation_id` may be empty, and a check holds that
-- exactly one of the two is set. Every protocol so far has its installation,
-- so the check holds for every row there is.
--
-- **Three units of the rule engine** for the limits of the test, from the
-- list in the foundation (`ruleUnits`), as in 0066, 0071 and 0077: milliohms,
-- microamperes and millimetres. This application stores none of them in
-- `tenant_parameters`.
--
-- Everything down to the policy comes from the schema; FORCE, the grants and
-- the triggers are written by hand.
--
-- **Fits the version before it**: it reads no appliance, writes every
-- protocol with its installation, and an unused value of an enum asks for
-- nothing.
CREATE TYPE "public"."appliance_mobility" AS ENUM('portable', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."appliance_protection_class" AS ENUM('I', 'II', 'III');--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'milliohms';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'microamperes';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'millimetres';--> statement-breakpoint
CREATE TABLE "appliances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"inventory_number" text,
	"designation" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"protection_class" "appliance_protection_class" NOT NULL,
	"mobility" "appliance_mobility" DEFAULT 'portable' NOT NULL,
	"location" text,
	"cord_length_milli" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "appliances_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "appliances_designation_named" CHECK (btrim("appliances"."designation") <> ''),
	CONSTRAINT "appliances_cord_length" CHECK ("appliances"."cord_length_milli" is null or "appliances"."cord_length_milli" between 1 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "appliances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_records" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "form_records" ADD COLUMN "appliance_id" uuid;--> statement-breakpoint
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appliances_site_idx" ON "appliances" USING btree ("tenant_id","site_id");--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_appliance_in_tenant" FOREIGN KEY ("tenant_id","appliance_id") REFERENCES "public"."appliances"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_records_appliance_idx" ON "form_records" USING btree ("tenant_id","appliance_id");--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_one_subject" CHECK (num_nonnulls("form_records"."installation_id", "form_records"."appliance_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "appliances" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("appliances"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("appliances"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "appliances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "appliances" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "appliances"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "appliances"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
