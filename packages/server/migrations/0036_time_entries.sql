-- Working time, #76: stretches of somebody's time as § 17 MiLoG records them,
-- and their answers to whether their place may be recorded with it.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grants, the two triggers every synced table
-- carries, one that writes whose time or answer a row is, and one that keeps an
-- entry as it was written for as long as the law wants it kept.
--
-- **Why a correction is a new row.** § 17 MiLoG asks for beginning, end and
-- duration, kept for two years, and a record that can be changed afterwards is
-- no record. A mistake is put right by an entry that names the one it corrects,
-- and an entry is corrected once: two corrections of the same one would be two
-- answers to what it should have been.
--
-- **Why a deletion is refused for two years and a bit.** The law counts the two
-- years "ab dem für die Aufzeichnung maßgeblichen Zeitpunkt", and the latest
-- reading of that is the end of the seven days within which the day had to be
-- recorded. An entry may go the day after the two years from there, which is
-- what `retentionEndsOn` in `domain` answers. Nothing deletes one yet; when a
-- cleanup comes, this is the bound it runs into.
--
-- **Why the rule units gain two values here.** The working time rules count in
-- minutes and years, and `rule_unit` is the type of `tenant_parameters.unit` as
-- well. Nothing in this migration uses the new values, which a value added in
-- the same transaction may not be.

CREATE TYPE "public"."time_entry_kind" AS ENUM('work', 'travel', 'break');--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'minutes';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'years';--> statement-breakpoint
CREATE TABLE "location_consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"given" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" time_entry_kind NOT NULL,
	"job_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"note" text,
	"corrects_entry_id" uuid,
	"withdrawn" boolean DEFAULT false NOT NULL,
	"start_latitude_micro" integer,
	"start_longitude_micro" integer,
	"end_latitude_micro" integer,
	"end_longitude_micro" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "time_entries_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "time_entries_end_after_start" CHECK ("time_entries"."ended_at" > "time_entries"."started_at"),
	CONSTRAINT "time_entries_at_most_a_day" CHECK ("time_entries"."ended_at" - "time_entries"."started_at" <= interval '24 hours'),
	CONSTRAINT "time_entries_withdraw_a_correction" CHECK (not "time_entries"."withdrawn" or "time_entries"."corrects_entry_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_consents" ADD CONSTRAINT "location_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_correction_in_tenant" FOREIGN KEY ("tenant_id","corrects_entry_id") REFERENCES "public"."time_entries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_consents_user_idx" ON "location_consents" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_corrected_once" ON "time_entries" USING btree ("tenant_id","corrects_entry_id") WHERE "time_entries"."corrects_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "time_entries" USING btree ("tenant_id","user_id","started_at");--> statement-breakpoint
CREATE INDEX "time_entries_job_idx" ON "time_entries" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "location_consents" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("location_consents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("location_consents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "time_entries" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("time_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("time_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "time_entries" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "location_consents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "location_consents" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "time_entries"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "time_entries"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "location_consents"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- Whose time or answer a row is, from the request and from nothing else.
-- Without a person in the transaction the column stays empty and the row is
-- refused: working time is always somebody's.
CREATE FUNCTION "record_time_owner"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.user_id := nullif(current_setting('app.user_id', true), '');

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "time_entries_record_owner" BEFORE INSERT ON "time_entries"
	FOR EACH ROW EXECUTE FUNCTION "record_time_owner"();--> statement-breakpoint
CREATE TRIGGER "location_consents_record_owner" BEFORE INSERT ON "location_consents"
	FOR EACH ROW EXECUTE FUNCTION "record_time_owner"();--> statement-breakpoint

-- Refuses every change, whoever asks, and every deletion until the entry has
-- been kept for as long as § 17 MiLoG wants it: two years from the seventh day
-- after the day of work, that day in Germany.
CREATE FUNCTION "time_entry_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'DELETE' AND current_date > ((old.started_at AT TIME ZONE 'Europe/Berlin')::date + 7 + interval '2 years')::date THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Ein Zeiteintrag wird nicht geändert und vor Ablauf der Aufbewahrung nach § 17 MiLoG nicht gelöscht. Eine Korrektur ist ein neuer Eintrag.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "time_entries_stay_as_written" BEFORE UPDATE OR DELETE ON "time_entries"
	FOR EACH ROW EXECUTE FUNCTION "time_entry_stays_as_written"();
