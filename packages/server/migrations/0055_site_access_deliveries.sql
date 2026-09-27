-- Which person got the value of which access on a device, #286: a row the
-- first time a pull hands a value to that person, never changed after. A
-- showing written on a device is taken only for an access its person got
-- this way. Measured against the job as it is now, as it was first, a showing
-- from a cellar was refused once the job had moved to another site or had
-- been closed for thirty days, and its record was lost (Greptile on #445).
--
-- Everything down to the policy comes from the schema. Written by hand:
-- FORCE, the grants, which let the application add a row and never change or
-- remove one, and the audit trigger, so that the log says which devices held
-- which code.

CREATE TABLE "site_access_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_access_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_access_deliveries_once" UNIQUE("tenant_id","site_access_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "site_access_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_access_deliveries" ADD CONSTRAINT "site_access_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_access_deliveries" ADD CONSTRAINT "site_access_deliveries_access_in_tenant" FOREIGN KEY ("tenant_id","site_access_id") REFERENCES "public"."site_accesses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_access_deliveries" ADD CONSTRAINT "site_access_deliveries_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_access_deliveries" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("site_access_deliveries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("site_access_deliveries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "site_access_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "site_access_deliveries" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "site_access_deliveries"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();