-- The papers of a PV system for its operator (#305, Feature-Gliederung v2.57).
--
-- **The forecast of the yield**: `installations` gains `yield_forecast_kwh`
-- and `yield_forecast_source`, what a PV system is planned to yield in a year
-- and where that comes from, typed in from the planning. Empty for every row
-- there is, and a check holds a forecast to a whole number of kilowatt hours
-- above nothing.
--
-- **The new table** `pv_handovers`: each handover of the folder to the
-- operator, frozen like a document. The application may add a row and read
-- it, and neither change nor delete one: the grant names SELECT and INSERT
-- only. It goes to no device and so carries no columns of the sync.
--
-- Everything down to the policy comes from the schema; FORCE, the grant and
-- the trigger are written by hand.
--
-- **Fits the version before it**: it reads neither column nor the table, and
-- writes an installation without them, which leaves them empty.
CREATE TABLE "pv_handovers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"handed_over_on" date NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "pv_handovers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "yield_forecast_kwh" integer;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "yield_forecast_source" text;--> statement-breakpoint
ALTER TABLE "pv_handovers" ADD CONSTRAINT "pv_handovers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_handovers" ADD CONSTRAINT "pv_handovers_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pv_handovers_installation_idx" ON "pv_handovers" USING btree ("tenant_id","installation_id");--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_yield_forecast" CHECK ("installations"."yield_forecast_kwh" is null or "installations"."yield_forecast_kwh" between 1 and 100000000);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pv_handovers" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("pv_handovers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("pv_handovers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "pv_handovers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "pv_handovers" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "pv_handovers"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
