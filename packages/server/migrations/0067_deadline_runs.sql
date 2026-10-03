-- The deadline engine moves into the foundation (ADR 0010,
-- opengewerk-haustechnik#24), and with it two things the foundation keeps
-- for every application.
--
-- What a business sets for a kind of deadline can count in months as well as
-- in days: a kind counts in one or the other, and a setting in the unit of its
-- kind, so `interval_months` comes beside `interval_days`, with its bounds and
-- a check that a row never sets both. The kinds of this application count in
-- days; nothing here writes the new column yet.
--
-- `deadline_runs` holds, per business, when the engine last went through its
-- deadlines and when it last failed to, so that a pass that did not happen is
-- seen in the office and not in a file on the server. One row per business,
-- written after every pass. The audit log does not watch it: it is a
-- heartbeat, once a minute, and would bury every change a person made.
--
-- Everything down to the policy is what drizzle-kit generated from the schema
-- of the foundation. FORCE and the grants after it are written by hand, as the
-- description of the table in the foundation says (`foundationGuards`): the
-- application writes and changes the row and never removes it.
--
-- **Fits the version before it.** That version never asks `deadline_runs`, and
-- a column that may be null, with checks every existing row passes, changes
-- nothing for the rows it reads and writes.

CREATE TABLE "deadline_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD COLUMN "interval_months" integer;--> statement-breakpoint
ALTER TABLE "deadline_runs" ADD CONSTRAINT "deadline_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_runs_tenant" ON "deadline_runs" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD CONSTRAINT "deadline_settings_interval_months_in_bounds" CHECK ("deadline_settings"."interval_months" is null or "deadline_settings"."interval_months" between 1 and 600);--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD CONSTRAINT "deadline_settings_one_unit" CHECK ("deadline_settings"."interval_days" is null or "deadline_settings"."interval_months" is null);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deadline_runs" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("deadline_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("deadline_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "deadline_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "deadline_runs" TO "opengewerk_app";
