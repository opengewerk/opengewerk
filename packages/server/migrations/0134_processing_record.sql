-- The record of the processing (#319, Art. 30 DSGVO, Feature-Gliederung v2.76),
-- as the Haustechnik keeps it (opengewerk-haustechnik#358), without the
-- documents it keeps: the record, the measures and the deletion concept are
-- made fresh whenever they are downloaded (Moritz, 05.11.2026).
--
-- `processing_record_settings`: who is responsible, the data protection
-- officer and what the business processes outside the application, one row
-- per business. `processing_record_activities`: per activity the purpose and
-- the legal basis whoever leads confirmed or changed, both or neither, and
-- the recipients. Taking a change back sets purpose and legal basis to null
-- again, so a row is never removed.
--
-- Both written only by whoever leads the business, as the restrictive
-- policies say, with the same question the deletion concept asks (0129). No
-- right is new: reading is `settings.read`, as on "Datenschutz".
--
-- **Fits the version before it.** That version knows neither table.
--
-- Everything down to the policies comes from the schema; FORCE, the grants
-- and the triggers are written by hand.
CREATE TABLE "processing_record_activities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity" text NOT NULL,
	"purpose" text,
	"legal_basis" text,
	"recipients" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_record_activities_once" UNIQUE("tenant_id","activity"),
	CONSTRAINT "processing_record_activities_confirmed_whole" CHECK (("processing_record_activities"."purpose" is null) = ("processing_record_activities"."legal_basis" is null))
);
--> statement-breakpoint
ALTER TABLE "processing_record_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "processing_record_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"controller" text,
	"officer" text,
	"outside" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_record_settings_once" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "processing_record_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processing_record_activities" ADD CONSTRAINT "processing_record_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_record_settings" ADD CONSTRAINT "processing_record_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "processing_record_activities" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("processing_record_activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("processing_record_activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "activities_written_by_whoever_leads" ON "processing_record_activities" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
CREATE POLICY "activities_changed_by_whoever_leads" ON "processing_record_activities" AS RESTRICTIVE FOR UPDATE TO "opengewerk_app" USING (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date))) WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "processing_record_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("processing_record_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("processing_record_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "settings_written_by_whoever_leads" ON "processing_record_settings" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
CREATE POLICY "settings_changed_by_whoever_leads" ON "processing_record_settings" AS RESTRICTIVE FOR UPDATE TO "opengewerk_app" USING (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date))) WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
ALTER TABLE "processing_record_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processing_record_activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "processing_record_settings" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("controller", "officer", "outside", "updated_at") ON "processing_record_settings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "processing_record_activities" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("purpose", "legal_basis", "recipients", "updated_at") ON "processing_record_activities" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "processing_record_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "processing_record_activities"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
