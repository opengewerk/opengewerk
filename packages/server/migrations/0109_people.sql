-- The files of the people who work for the business (#287, Feature-Gliederung
-- v2.44, ADR 0016), with the factories of the foundation: a person with an
-- account of the business or without one, the working time agreed with each
-- from a day on, and their qualifications with the kinds the business adds
-- to those of the catalogue.
--
-- **The new tables** carry the columns of the sync and travel to no device
-- yet; a person reads their own file online. Nothing is removed: the
-- application may read, add and change, and takes a row out by marking it.
--
-- **The rights** "Akten der Mitarbeiter ansehen" and "... pflegen" go to the
-- owner of every business there is, as the role has them in the code from
-- now on; the office and the technician get neither.
--
-- Everything down to the policies comes from the schema; FORCE, the grants,
-- the triggers and the rights of the roles are written by hand.
--
-- **Fits the version before it**: it reads none of the new tables, and a role
-- with a right it does not know asks for nothing more.
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"joined_on" date,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "people_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "people_name_fits" CHECK (char_length("people"."name") between 1 and 120),
	CONSTRAINT "people_leave_after_joining" CHECK ("people"."left_on" is null or "people"."joined_on" is null or "people"."left_on" >= "people"."joined_on")
);
--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "qualification_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "qualification_kinds_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "qualification_kinds_label_fits" CHECK (char_length("qualification_kinds"."label") between 1 and 120),
	CONSTRAINT "qualification_kinds_level_known" CHECK ("qualification_kinds"."level" in ('instructed_person', 'skilled_person', 'competent_person'))
);
--> statement-breakpoint
ALTER TABLE "qualification_kinds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind_key" text,
	"own_kind_id" uuid,
	"valid_until" date,
	"note" text,
	"certificate_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "qualifications_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "qualifications_one_kind" CHECK (num_nonnulls("qualifications"."kind_key", "qualifications"."own_kind_id") = 1),
	CONSTRAINT "qualifications_kind_key_fits" CHECK ("qualifications"."kind_key" is null or char_length("qualifications"."kind_key") between 1 and 120),
	CONSTRAINT "qualifications_note_fits" CHECK ("qualifications"."note" is null or char_length("qualifications"."note") between 1 and 500),
	CONSTRAINT "qualifications_certificate_is_a_hash" CHECK ("qualifications"."certificate_sha256" is null or "qualifications"."certificate_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "qualifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "working_times" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"monday_minutes" integer DEFAULT 0 NOT NULL,
	"tuesday_minutes" integer DEFAULT 0 NOT NULL,
	"wednesday_minutes" integer DEFAULT 0 NOT NULL,
	"thursday_minutes" integer DEFAULT 0 NOT NULL,
	"friday_minutes" integer DEFAULT 0 NOT NULL,
	"saturday_minutes" integer DEFAULT 0 NOT NULL,
	"sunday_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "working_times_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "working_times_a_day_at_most" CHECK ("working_times"."monday_minutes" between 0 and 1440 and "working_times"."tuesday_minutes" between 0 and 1440 and "working_times"."wednesday_minutes" between 0 and 1440
        and "working_times"."thursday_minutes" between 0 and 1440 and "working_times"."friday_minutes" between 0 and 1440
        and "working_times"."saturday_minutes" between 0 and 1440 and "working_times"."sunday_minutes" between 0 and 1440)
);
--> statement-breakpoint
ALTER TABLE "working_times" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_account_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_kinds" ADD CONSTRAINT "qualification_kinds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_of_somebody_here" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_of_an_own_kind" FOREIGN KEY ("tenant_id","own_kind_id") REFERENCES "public"."qualification_kinds"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_certificate_stored" FOREIGN KEY ("tenant_id","certificate_sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_times" ADD CONSTRAINT "working_times_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_times" ADD CONSTRAINT "working_times_of_a_person_here" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_one_per_account" ON "people" USING btree ("tenant_id","user_id") WHERE "people"."user_id" is not null and "people"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_kinds_label_once" ON "qualification_kinds" USING btree ("tenant_id",lower("label")) WHERE "qualification_kinds"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "qualifications_of_a_person" ON "qualifications" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "working_times_one_from_a_day" ON "working_times" USING btree ("tenant_id","person_id","valid_from") WHERE "working_times"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "working_times_of_a_person" ON "working_times" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "people" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("people"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "qualification_kinds" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("qualification_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("qualification_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "qualifications" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("qualifications"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("qualifications"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "working_times" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("working_times"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("working_times"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "working_times" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qualification_kinds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qualifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "people" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "working_times" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "qualification_kinds" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "qualifications" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "people"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "working_times"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "qualification_kinds"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "qualifications"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "people"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "working_times"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "qualification_kinds"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "qualifications"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
-- The two new rights for the owner of every business there is, as the role
-- in the code has them from now on.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'person.read')
 WHERE "key" = 'owner' AND NOT ('person.read' = ANY ("rights"));--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'person.write')
 WHERE "key" = 'owner' AND NOT ('person.write' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
