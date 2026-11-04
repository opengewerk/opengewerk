-- Leads and the sales pipeline (#312, Feature-Gliederung v2.68).
--
-- **The new table** `prospects`, the leads of the office: who asked before
-- there is a customer, what they want, where they came from (`prospect_source`)
-- and how far the office has qualified them (`prospect_stage`), with the last
-- day of contact the deletion run of #317 reads. Becoming a customer fills the
-- customer, the site and the moment together, once. It goes to no device and
-- carries no columns of the sync; a lead that never became a customer is
-- deleted for real, and the audit log keeps the deletion.
--
-- **`customers.source`**: how the customer found the business, from its lead
-- or chosen in the office. Empty for every customer there is.
--
-- **The rights** `prospect.read` and `prospect.write` go to the owner and the
-- office of every business, as the code gives them to them. Row level
-- security is lifted on `tenant_roles` for the statement: an installation
-- migrates as the owner, and under FORCE the owner finds no row (0029, 0095).
--
-- Everything down to the policy comes from the schema; FORCE, the grant, the
-- trigger and the rights are written by hand.
--
-- **Fits the version before it**: it reads neither the table nor the column
-- nor the rights, and writes a customer without a source, which leaves it
-- empty.
CREATE TYPE "public"."prospect_source" AS ENUM('referral', 'website', 'phone', 'email', 'other');--> statement-breakpoint
CREATE TYPE "public"."prospect_stage" AS ENUM('new', 'contacted', 'qualified', 'dismissed');--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "customer_kind" DEFAULT 'private' NOT NULL,
	"name" text NOT NULL,
	"concern" text,
	"email" text,
	"phone" text,
	"street" text,
	"house_number" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"source" "prospect_source" NOT NULL,
	"stage" "prospect_stage" DEFAULT 'new' NOT NULL,
	"last_contact_on" date NOT NULL,
	"customer_id" uuid,
	"site_id" uuid,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "prospects_texts_fit" CHECK (char_length("prospects"."name") between 1 and 200
        and char_length(coalesce("prospects"."concern", '')) <= 5000),
	CONSTRAINT "prospects_country_code" CHECK ("prospects"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "prospects_converted" CHECK (("prospects"."customer_id" is null) = ("prospects"."converted_at" is null)
        and ("prospects"."customer_id" is null) = ("prospects"."site_id" is null)
        and ("prospects"."customer_id" is null or "prospects"."stage" <> 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "source" "prospect_source";--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospects_customer_idx" ON "prospects" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospects" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("prospects"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("prospects"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "prospects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "prospects" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "prospects"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'prospect.read')
 WHERE "key" IN ('owner', 'office') AND NOT ('prospect.read' = ANY ("rights"));--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'prospect.write')
 WHERE "key" IN ('owner', 'office') AND NOT ('prospect.write' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
