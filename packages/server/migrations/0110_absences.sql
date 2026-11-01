-- Leave and sickness of the people of the business, and the public holidays
-- they are counted with (#288, Feature-Gliederung v2.45).
--
-- **The new tables**: an absence of a person, a span of days either end of
-- which may be half; the days of leave of a person for a year with what came
-- over from the year before; and where the business is for its holidays, its
-- state and the local holidays it switched on. They carry the columns of the
-- sync and travel to no device; nothing is removed, a row is taken out by
-- marking it.
--
-- **The unit** `wednesday_before` comes into `rule_unit` from the list in
-- the foundation, for the day of repentance and prayer in Saxony. OpenGewerk
-- Haustechnik needs the same value in its own migration when it raises the
-- submodule.
--
-- **The right** "Abwesenheiten pflegen" goes to the owner and the office of
-- every business there is, as the roles have it in the code from now on
-- (decided on 01.11.2026); the technician does not get it and asks for leave
-- of their own without it.
--
-- Everything down to the policies comes from the schema; FORCE, the grants,
-- the triggers and the rights of the roles are written by hand.
--
-- **Fits the version before it**: it reads none of the new tables, an unused
-- value of an enum asks for nothing, and a role with a right it does not know
-- asks for nothing more.
CREATE TYPE "public"."absence_kind" AS ENUM('vacation', 'sickness');--> statement-breakpoint
CREATE TYPE "public"."absence_state" AS ENUM('requested', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'wednesday_before';--> statement-breakpoint
CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "absence_kind" NOT NULL,
	"state" "absence_state" NOT NULL,
	"first_day" date NOT NULL,
	"last_day" date NOT NULL,
	"starts_at_noon" boolean DEFAULT false NOT NULL,
	"ends_at_noon" boolean DEFAULT false NOT NULL,
	"note" text,
	"answer" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "absences_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "absences_days_in_order" CHECK ("absences"."last_day" >= "absences"."first_day"),
	CONSTRAINT "absences_not_half_twice" CHECK (not ("absences"."first_day" = "absences"."last_day" and "absences"."starts_at_noon" and "absences"."ends_at_noon")),
	CONSTRAINT "absences_sickness_entered" CHECK ("absences"."kind" <> 'sickness' or ("absences"."state" = 'approved' and "absences"."note" is null)),
	CONSTRAINT "absences_note_fits" CHECK ("absences"."note" is null or char_length("absences"."note") between 1 and 500),
	CONSTRAINT "absences_answer_fits" CHECK ("absences"."answer" is null or char_length("absences"."answer") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "absences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holiday_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state" text NOT NULL,
	"local_holidays" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "holiday_settings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "holiday_settings_state_known" CHECK ("holiday_settings"."state" in ('DE-SH', 'DE-HH', 'DE-NI', 'DE-HB', 'DE-NW', 'DE-HE', 'DE-RP', 'DE-BW', 'DE-BY', 'DE-SL', 'DE-BE', 'DE-BB', 'DE-MV', 'DE-SN', 'DE-ST', 'DE-TH')),
	CONSTRAINT "holiday_settings_local_are_local" CHECK (array_position("holiday_settings"."local_holidays", null) is null and coalesce(array_length("holiday_settings"."local_holidays", 1), 0) <= 20)
);
--> statement-breakpoint
ALTER TABLE "holiday_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"entitled_half_days" integer DEFAULT 0 NOT NULL,
	"carried_half_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "leave_entitlements_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "leave_entitlements_year_known" CHECK ("leave_entitlements"."year" between 2000 and 2100),
	CONSTRAINT "leave_entitlements_half_days_fit" CHECK ("leave_entitlements"."entitled_half_days" between 0 and 732
        and "leave_entitlements"."carried_half_days" between 0 and 732)
);
--> statement-breakpoint
ALTER TABLE "leave_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_of_somebody_here" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_settings" ADD CONSTRAINT "holiday_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entitlements" ADD CONSTRAINT "leave_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entitlements" ADD CONSTRAINT "leave_entitlements_of_somebody_here" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_of_a_person" ON "absences" USING btree ("tenant_id","person_id","first_day");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_settings_one_a_business" ON "holiday_settings" USING btree ("tenant_id") WHERE "holiday_settings"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_entitlements_one_a_year" ON "leave_entitlements" USING btree ("tenant_id","person_id","year") WHERE "leave_entitlements"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "absences" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("absences"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("absences"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "holiday_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("holiday_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("holiday_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leave_entitlements" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("leave_entitlements"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("leave_entitlements"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "absences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holiday_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "absences" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "leave_entitlements" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "holiday_settings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "absences"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "leave_entitlements"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "holiday_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "absences"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "leave_entitlements"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "holiday_settings"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
-- The new right for the owner and the office of every business there is, as
-- the roles in the code have it from now on.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'absence.write')
 WHERE "key" IN ('owner', 'office') AND NOT ('absence.write' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
