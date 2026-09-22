-- Tasks, #80: something one person has to do by a day, hanging on a customer,
-- a site or a job, or on nothing at all.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grant, the two triggers every synced table
-- carries, and one of its own that writes who created the task.
--
-- **Why the author is written by the database.** `created_by` names who wrote
-- the task, or nobody. The deadline engine of phase 2 will create tasks in a
-- transaction that acts for no person and so gets a task without an author,
-- through the same table and the same triggers as everybody else. The trigger
-- takes the value from `app.user_id`, which the server sets from the request,
-- as `stamp_sync_columns` does for `updated_by`: a device cannot put a task
-- under somebody else's name, and no later change can rewrite who wrote it.
--
-- **Why the person runs through the membership.** The key on tenant and user
-- together only finds a membership of the same business, so a task cannot be
-- handed to a user of the instance who works next door.
--
-- **Why no DELETE.** A synced row is marked deleted and not removed, so the
-- grant stops at UPDATE.

CREATE TYPE "public"."task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_on" date NOT NULL,
	"assignee_user_id" text NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"customer_id" uuid,
	"site_id" uuid,
	"job_id" uuid,
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
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_works_here" FOREIGN KEY ("tenant_id","assignee_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("tenant_id","assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_customer_idx" ON "tasks" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "tasks_site_idx" ON "tasks" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "tasks_job_idx" ON "tasks" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tasks" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tasks"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tasks"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tasks" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- Who wrote the task, from the request and from nothing else. On an update the
-- value stays what it was, whatever the statement says.
CREATE FUNCTION "record_task_author"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'INSERT' THEN
		new.created_by := nullif(current_setting('app.user_id', true), '');
	ELSE
		new.created_by := old.created_by;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "tasks_record_author" BEFORE INSERT OR UPDATE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "record_task_author"();
