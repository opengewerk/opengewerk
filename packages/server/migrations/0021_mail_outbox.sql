-- The mail outbox, #81: every message the instance sends, written in the
-- transaction of whatever caused it and sent afterwards by the job in
-- `mail/worker.ts`. A mail server that does not answer costs time and nothing
-- else, because the row waits.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grant, the audit trigger, and the one
-- function the job needs to find the businesses it works for.
--
-- **Why no DELETE.** A message is never taken back out, sent or not. A row
-- that says an invoice went to a customer on a certain day is part of what
-- happened, and one that says it did not arrive is the reason somebody calls.
--
-- **Why the audit trigger, on a table the job writes every minute.** Only a
-- claimed or finished message changes, so the log grows with the messages and
-- not with the clock. In return it records when something was sent and by
-- whom, which for an invoice is the day it was transmitted.
--
-- **Why `every_tenant()`.** The job acts for no person, so it has no
-- membership to reach a business through, and outside a business `tenants`
-- is readable only as far as one's memberships go. The function answers with
-- the identifiers and nothing else, as the owner of the table, which may read
-- it whole since 0011. Every read after that runs inside `forTenant` like any
-- other, so the isolation of the data is where it was.

CREATE TYPE "public"."mail_kind" AS ENUM('task_due');--> statement-breakpoint
CREATE TYPE "public"."mail_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "mail_kind" NOT NULL,
	"cause" text NOT NULL,
	"task_id" uuid,
	"sender_name" text NOT NULL,
	"reply_to" text,
	"recipient_address" text NOT NULL,
	"recipient_name" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "mail_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_once_per_cause" UNIQUE("tenant_id","cause")
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_due_idx" ON "mail_outbox" USING btree ("tenant_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_task_idx" ON "mail_outbox" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mail_outbox" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("mail_outbox"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("mail_outbox"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mail_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "mail_outbox" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "mail_outbox" FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE FUNCTION "every_tenant"() RETURNS SETOF uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT id FROM public.tenants ORDER BY id
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "every_tenant"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "every_tenant"() TO "opengewerk_app";
