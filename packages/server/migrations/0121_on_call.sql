-- The on-call service, #293: the times of the on-call plan, the moment of an
-- emergency call at a job, the settings of the surcharges on the invoice to
-- the customer, and the narrow right to make a service call while on call.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grants, the two triggers every synced table
-- carries, and the new right "Serviceeinsätze in der Bereitschaft anlegen" for
-- the owner, the office and the technician of every business there is.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing here does.
--
-- **Fits the version before it**: it reads no setting by a key it does not
-- know, and the right is only asked by the new version.

ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.night_flat_cents';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.night_basis_points';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.weekend_flat_cents';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.weekend_basis_points';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.holiday_flat_cents';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.holiday_basis_points';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.night_from_minute';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'emergency.night_until_minute';--> statement-breakpoint
CREATE TABLE "on_call_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "on_call_shifts_ends_after_start" CHECK ("on_call_shifts"."ends_at" > "on_call_shifts"."starts_at"),
	CONSTRAINT "on_call_shifts_note_short" CHECK ("on_call_shifts"."note" is null or length("on_call_shifts"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "on_call_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "emergency_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "on_call_shifts" ADD CONSTRAINT "on_call_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_call_shifts" ADD CONSTRAINT "on_call_shifts_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "on_call_shifts_person_idx" ON "on_call_shifts" USING btree ("tenant_id","user_id","starts_at");--> statement-breakpoint
CREATE INDEX "on_call_shifts_starts_idx" ON "on_call_shifts" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "on_call_shifts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("on_call_shifts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("on_call_shifts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);;--> statement-breakpoint

ALTER TABLE "on_call_shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "on_call_shifts" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "on_call_shifts"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "on_call_shifts"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- The new right "Serviceeinsätze in der Bereitschaft anlegen" for the owner,
-- the office and the technician of every business there is.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'job.on_call')
 WHERE "key" IN ('owner', 'office', 'technician') AND NOT ('job.on_call' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
