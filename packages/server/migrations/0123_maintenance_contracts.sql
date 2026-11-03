-- Maintenance contracts (#294, Feature-Gliederung v2.65).
--
-- **The new table** `maintenance_contracts`: which installations at a site of
-- a customer the business looks after, every how many months, for which term
-- and renewal, with what notice and at what price, out of an issued quote,
-- one contract per quote. It goes to no device and carries no columns of the
-- sync. A contract is deleted for real while no service job names it, and
-- the audit log keeps the deletion.
--
-- **The number range** `contract` for its number, one value more in the enum;
-- the range is made on first use like every other (0037).
--
-- **`jobs`** gains `maintenance_contract_id` and `maintenance_due_on`: the
-- contract whose deadline made a service job and the day the maintenance is
-- due, one job per contract and day. Empty for every job there is.
--
-- Everything down to the policy comes from the schema; FORCE, the grant, the
-- trigger and switching FORCE off on `jobs` around its new key are written by
-- hand: the owner migrating sees no row of `jobs` under FORCE.
--
-- **Fits the version before it**: it reads neither the table nor the two
-- columns, and writes a job without them, which leaves them empty.
ALTER TYPE "public"."number_range_key" ADD VALUE 'contract';--> statement-breakpoint
CREATE TABLE "maintenance_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"designation" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid,
	"quote_id" uuid NOT NULL,
	"installation_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"services" text,
	"starts_on" date NOT NULL,
	"first_visit_on" date NOT NULL,
	"interval_months" integer NOT NULL,
	"term_months" integer NOT NULL,
	"renewal" text NOT NULL,
	"renewal_months" integer,
	"notice_months" integer NOT NULL,
	"price_kind" text NOT NULL,
	"flat_cents" integer,
	"payment_rhythm" text DEFAULT 'visit' NOT NULL,
	"cancelled_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_contracts_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "maintenance_contracts_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "maintenance_contracts_quote_key" UNIQUE("tenant_id","quote_id"),
	CONSTRAINT "maintenance_contracts_texts_fit" CHECK (char_length("maintenance_contracts"."designation") between 1 and 200
        and char_length(coalesce("maintenance_contracts"."services", '')) <= 5000
        and char_length("maintenance_contracts"."number") between 1 and 40),
	CONSTRAINT "maintenance_contracts_visits" CHECK ("maintenance_contracts"."interval_months" between 1 and 120
        and "maintenance_contracts"."first_visit_on" >= "maintenance_contracts"."starts_on"
        and cardinality("maintenance_contracts"."installation_ids") <= 50),
	CONSTRAINT "maintenance_contracts_term" CHECK ("maintenance_contracts"."term_months" between 1 and 120
        and "maintenance_contracts"."notice_months" between 0 and 24
        and "maintenance_contracts"."renewal" in ('none', 'fixed', 'indefinite')
        and ("maintenance_contracts"."renewal" = 'fixed') = ("maintenance_contracts"."renewal_months" is not null)
        and coalesce("maintenance_contracts"."renewal_months", 1) between 1 and 60),
	CONSTRAINT "maintenance_contracts_price" CHECK ("maintenance_contracts"."price_kind" in ('flat', 'effort')
        and ("maintenance_contracts"."price_kind" = 'flat') = ("maintenance_contracts"."flat_cents" is not null)
        and coalesce("maintenance_contracts"."flat_cents", 0) between 0 and 10000000
        and "maintenance_contracts"."payment_rhythm" in ('visit', 'monthly', 'quarterly', 'yearly')
        and ("maintenance_contracts"."payment_rhythm" = 'visit' or "maintenance_contracts"."price_kind" = 'flat')),
	CONSTRAINT "maintenance_contracts_notice" CHECK (("maintenance_contracts"."cancelled_on" is null) = ("maintenance_contracts"."ends_on" is null)
        and ("maintenance_contracts"."ends_on" is null or "maintenance_contracts"."ends_on" >= "maintenance_contracts"."starts_on"))
);
--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "maintenance_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "maintenance_due_on" date;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_quote_in_tenant" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_contracts_customer_idx" ON "maintenance_contracts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "maintenance_contracts_site_idx" ON "maintenance_contracts" USING btree ("tenant_id","site_id");--> statement-breakpoint
ALTER TABLE "jobs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_maintenance_contract_in_tenant" FOREIGN KEY ("tenant_id","maintenance_contract_id") REFERENCES "public"."maintenance_contracts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_maintenance_visit_key" UNIQUE("maintenance_contract_id","maintenance_due_on");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_maintenance_visit" CHECK (("jobs"."maintenance_contract_id" is null) = ("jobs"."maintenance_due_on" is null)
        and ("jobs"."maintenance_contract_id" is null or "jobs"."kind" = 'service'));--> statement-breakpoint
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "maintenance_contracts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("maintenance_contracts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("maintenance_contracts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "maintenance_contracts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "maintenance_contracts" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "maintenance_contracts"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
