-- The deadline engine, #283: one record for everything that falls due, and
-- what a business sets for each kind of it.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE, the grants and the audit trigger on both tables.
--
-- **Why no sync columns.** A deadline is worked out on the server from what the
-- devices sent: the engine in `deadlines/` follows its source, and the office
-- changes only what the office decides. A device has nothing to add to it and
-- reads the tasks a deadline makes, which travel as before.
--
-- **Why the kind is text and not an enum.** The kinds come from the core and
-- from the trade packages (ADR 0008). A new kind is a JSON file in a package,
-- and it must not need a migration; the registry in the server checks every
-- kind when the instance starts.
--
-- **Why no DELETE.** A deadline is done or dropped, never removed: what it made
-- happen, a task or a message, points back at it. A setting is changed back to
-- the kind's own value by writing null, so the grant stops at UPDATE there too.
--
-- The new value of `mail_kind` is not used in this migration: all pending
-- migrations run in one transaction, and a value may not be used in the
-- transaction that adds it.

CREATE TYPE "public"."deadline_status" AS ENUM('open', 'done', 'dropped');--> statement-breakpoint
ALTER TYPE "public"."mail_kind" ADD VALUE 'deadline_due';--> statement-breakpoint
CREATE TABLE "deadline_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lead_days" integer,
	"interval_days" integer,
	"responsible_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_settings_once_per_kind" UNIQUE("tenant_id","kind"),
	CONSTRAINT "deadline_settings_lead_in_bounds" CHECK ("deadline_settings"."lead_days" is null or "deadline_settings"."lead_days" between 0 and 365),
	CONSTRAINT "deadline_settings_interval_in_bounds" CHECK ("deadline_settings"."interval_days" is null or "deadline_settings"."interval_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "deadline_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_label" text NOT NULL,
	"document_id" uuid,
	"installation_id" uuid,
	"customer_id" uuid,
	"site_id" uuid,
	"job_id" uuid,
	"anchor_on" date NOT NULL,
	"due_on" date NOT NULL,
	"lead_days" integer,
	"responsible_user_id" text,
	"natural_user_id" text,
	"status" "deadline_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"reminded_for" date,
	"reminded_at" timestamp with time zone,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadlines_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "deadlines_once_per_source" UNIQUE("tenant_id","kind","source_id"),
	CONSTRAINT "deadlines_lead_in_bounds" CHECK ("deadlines"."lead_days" is null or "deadlines"."lead_days" between 0 and 365),
	CONSTRAINT "deadlines_closed_when_not_open" CHECK (("deadlines"."status" = 'open') = ("deadlines"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "deadlines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "deadline_id" uuid;--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD CONSTRAINT "deadline_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD CONSTRAINT "deadline_settings_responsible_works_here" FOREIGN KEY ("tenant_id","responsible_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_task_in_tenant" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_responsible_works_here" FOREIGN KEY ("tenant_id","responsible_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadlines_due_idx" ON "deadlines" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "deadlines_customer_idx" ON "deadlines" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "deadlines_document_idx" ON "deadlines" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "deadlines_task_idx" ON "deadlines" USING btree ("tenant_id","task_id");--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_deadline_in_tenant" FOREIGN KEY ("tenant_id","deadline_id") REFERENCES "public"."deadlines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_deadline_idx" ON "mail_outbox" USING btree ("tenant_id","deadline_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deadline_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("deadline_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("deadline_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deadlines" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("deadlines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("deadlines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadline_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "deadlines" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "deadline_settings" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "deadlines"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "deadline_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
