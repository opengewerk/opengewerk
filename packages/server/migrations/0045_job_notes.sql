-- Notes from the site, #220: what happened at a job, written by whoever was
-- there, each note a row of its own with its author and the moment it was
-- written.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grant, the two triggers every synced table
-- carries, and one that writes who wrote the note.
--
-- **Why a table and not the description.** Until now a note written on site
-- went into `jobs.description`, the field in which the office puts down what
-- the job is, and replaced it. The description stays the office's; what
-- happened on site is added, not written over.
--
-- **Why the grant stops at INSERT.** A note is a record of what somebody
-- wrote at a moment, like a time entry, and one that turns out wrong is
-- followed by another note rather than rewritten. The sync writes a note once,
-- as it writes a time entry or a version of a file, and the stamp of the sync
-- columns runs on the insert.
--
-- **Why `written_at` comes from the device.** A note written in a cellar at
-- ten reaches the server when the device has a network again, and ten is the
-- time the note is about. `created_at` stays the moment it arrived.

CREATE TABLE "job_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"text" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_notes" ADD CONSTRAINT "job_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_notes" ADD CONSTRAINT "job_notes_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_notes_job_idx" ON "job_notes" USING btree ("tenant_id","job_id","written_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "job_notes" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("job_notes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("job_notes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "job_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "job_notes" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "job_notes"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "job_notes"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- Who wrote the note, from the request and from nothing else, as for a task:
-- a device cannot put a note under somebody else's name.
CREATE FUNCTION "record_note_author"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.created_by := nullif(current_setting('app.user_id', true), '');

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "job_notes_record_author" BEFORE INSERT ON "job_notes"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();
