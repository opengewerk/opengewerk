-- Each device holds its part of the business, #140. A technician's device
-- gets the jobs its person is assigned to, with what hangs on them, and what
-- that person created; the owner and the office keep the whole business
-- (`job.read.all`). Which jobs a person is on is `job_assignments`; how long
-- a closed job stays is measured from `jobs.closed_at`.
--
-- Everything down to the policy comes from the schema. What follows is written
-- by hand: FORCE and the grants, the audit and sync triggers of the new
-- table, the day on which each job that is closed already was closed, and the
-- trigger that keeps that day from now on.
--
-- **The day of the jobs closed before this version.** Nothing recorded it, so
-- the day of their last change stands in for it, which for a job finished and
-- left alone is the day it was finished. Without it every closed job would
-- leave the devices at once instead of thirty days after it was closed.
-- Migrations run as the owner and `jobs` stands on FORCE ROW LEVEL SECURITY,
-- which no policy of the owner's passes, so FORCE is off for the length of
-- the update, inside the transaction, as in 0031 and 0032; the audit log
-- names the migration as the reason. It comes before the trigger, which would
-- otherwise keep the empty day it finds.
--
-- The application may read and insert assignments and mark one deleted, and
-- nothing else: who is on a job is set at the route and removed there.

CREATE TABLE "job_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_assignments_once" ON "job_assignments" USING btree ("tenant_id","job_id","user_id") WHERE "job_assignments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "job_assignments_person_idx" ON "job_assignments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "job_assignments" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("job_assignments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("job_assignments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "job_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "job_assignments" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("deleted_at") ON "job_assignments" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "job_assignments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "job_assignments"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

ALTER TABLE "jobs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "jobs" SET "closed_at" = "updated_at" WHERE "status" IN ('completed', 'cancelled');--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The day a job was closed, from its status and from nothing a writer sends:
-- set when the status goes to completed or cancelled, kept while it stays
-- there, emptied when the job is taken up again.
CREATE FUNCTION "stamp_closed_at"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.status IN ('completed', 'cancelled') THEN
		IF tg_op = 'INSERT' OR old.status NOT IN ('completed', 'cancelled') THEN
			new.closed_at := now();
		ELSE
			new.closed_at := old.closed_at;
		END IF;
	ELSE
		new.closed_at := NULL;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "jobs_stamp_closed_at" BEFORE INSERT OR UPDATE ON "jobs"
	FOR EACH ROW EXECUTE FUNCTION "stamp_closed_at"();
