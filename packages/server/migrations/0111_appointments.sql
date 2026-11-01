-- The appointments of the planning board (#290, Feature-Gliederung v2.47).
--
-- **The new tables**: an appointment at a job, with its beginning, its end,
-- a short note and, for a series, its rule after RFC 5545 and the days taken
-- out of it; and who goes to it, with the version of it they confirmed. Both
-- carry the columns of the sync and travel to the devices, which read them
-- and write none; nothing is removed, a row is taken out by marking it.
--
-- **The occasion** `appointment` comes into `push_kind` before the test
-- message of the foundation, where the list in the code has it: a new,
-- changed or cancelled appointment goes to the people on it by push.
--
-- Everything down to the policies comes from the schema; FORCE, the grants
-- and the triggers are written by hand.
--
-- **Fits the version before it**: it reads none of the new tables, and an
-- unused value of an enum asks for nothing.
ALTER TYPE "public"."push_kind" ADD VALUE 'appointment' BEFORE 'test';--> statement-breakpoint
CREATE TABLE "appointment_people" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_revision" integer,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "appointment_people_confirmed_together" CHECK (("appointment_people"."confirmed_revision" is null) = ("appointment_people"."confirmed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "appointment_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"rrule" text,
	"exdates" date[] DEFAULT '{}'::date[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "appointments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "appointments_end_after_start" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_note_fits" CHECK ("appointments"."note" is null or char_length("appointments"."note") between 1 and 500),
	CONSTRAINT "appointments_rule_fits" CHECK ("appointments"."rrule" is null or char_length("appointments"."rrule") between 10 and 200),
	CONSTRAINT "appointments_exdates_of_a_series" CHECK (("appointments"."rrule" is not null or cardinality("appointments"."exdates") = 0)
        and cardinality("appointments"."exdates") <= 366
        and array_position("appointments"."exdates", null) is null),
	CONSTRAINT "appointments_revision_counts" CHECK ("appointments"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment_people" ADD CONSTRAINT "appointment_people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_people" ADD CONSTRAINT "appointment_people_of_an_appointment" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_people" ADD CONSTRAINT "appointment_people_work_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_people_once" ON "appointment_people" USING btree ("tenant_id","appointment_id","user_id") WHERE "appointment_people"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "appointment_people_of_a_person" ON "appointment_people" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "appointments_of_a_job" ON "appointments" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "appointments_by_start" ON "appointments" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "appointment_people" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("appointment_people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("appointment_people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "appointments" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("appointments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("appointments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment_people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "appointments" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "appointment_people" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("deleted_at", "confirmed_revision", "confirmed_at") ON "appointment_people" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "appointments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "appointment_people"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "appointments"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "appointment_people"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
