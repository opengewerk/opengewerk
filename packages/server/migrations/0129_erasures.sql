-- The deletion concept, its groundwork (#317, Feature-Gliederung v2.71).
--
-- **The new table** `erasures`: the protocol of the deletion concept, one row
-- per record that went, written in the transaction that deleted it. It names
-- nobody: the kind, the key of the record, a label without a name, the day it
-- fell due, whether the pass did it by itself and how many values the change
-- log blacked out. Written once: the grant stops at INSERT, and `created_by`
-- comes from the request through `record_note_author`, as for the notes of a
-- job (0045); without a person in the request the row is refused.
--
-- **The new table** `erasure_automations`: a row for each kind of the concept
-- that goes by itself, with who switched it on. Switching off deletes the row.
--
-- **Who**: both tables are written only by somebody who leads the tenant, the
-- question the policy of `audit_redactions` asks (ADR 0013), as restrictive
-- policies for INSERT and, on the second, for DELETE. Neither goes to a
-- device or carries the columns of the sync.
--
-- Everything down to the policies comes from the schema; FORCE, the grants
-- and the triggers are written by hand.
--
-- **Fits the version before it**: it reads the tables nowhere and writes
-- nothing else.
CREATE TYPE "public"."erasure_kind" AS ENUM('prospect');--> statement-breakpoint
CREATE TABLE "erasure_automations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "erasure_kind" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erasure_automations_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "erasure_automations_once" UNIQUE("tenant_id","kind")
);
--> statement-breakpoint
ALTER TABLE "erasure_automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "erasures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "erasure_kind" NOT NULL,
	"record_id" uuid NOT NULL,
	"label" text NOT NULL,
	"due_on" date,
	"automatic" boolean NOT NULL,
	"redactions" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erasures_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "erasures_once" UNIQUE("tenant_id","kind","record_id"),
	CONSTRAINT "erasures_label_fits" CHECK (char_length("erasures"."label") between 1 and 200),
	CONSTRAINT "erasures_redactions_counted" CHECK ("erasures"."redactions" >= 0)
);
--> statement-breakpoint
ALTER TABLE "erasures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "erasure_automations" ADD CONSTRAINT "erasure_automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasures" ADD CONSTRAINT "erasures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "erasures_time_idx" ON "erasures" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "erasure_automations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("erasure_automations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("erasure_automations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "switched_on_by_whoever_leads" ON "erasure_automations" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
CREATE POLICY "switched_off_by_whoever_leads" ON "erasure_automations" AS RESTRICTIVE FOR DELETE TO "opengewerk_app" USING (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "erasures" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("erasures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("erasures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "erased_by_whoever_leads" ON "erasures" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
ALTER TABLE "erasures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "erasure_automations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "erasures" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "erasure_automations" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "erasures"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "erasures_record_author" BEFORE INSERT ON "erasures"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "erasure_automations"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "erasure_automations_record_author" BEFORE INSERT ON "erasure_automations"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();
