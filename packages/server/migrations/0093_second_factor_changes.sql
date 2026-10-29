-- A record every business keeps of what happens to the second factor of
-- the people who work in it (N6 of the security audit).
--
-- A passkey comes into the log through `member_passkeys`. The app came
-- nowhere, and on an account without a second factor the password alone
-- set it up. From now on **`second_factor_changes`** has a row per change and
-- business the account works in: the app set up, or every second factor of
-- the account taken away by the owner of a business or with
-- `reset-second-factor` on the server. Which of the two it was is the reason
-- of the entry in the log; the row says whose and when.
--
-- The table is the foundation's; every application adds it with a migration
-- of its own. Everything down to the policy comes from the schema. What
-- follows it is written by hand: FORCE, the grant and the audit trigger. A row
-- says what happened at one moment, so the grant stops at INSERT.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this migration runs on unchanged; it writes no such rows.
CREATE TABLE "second_factor_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "second_factor_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "second_factor_changes" ADD CONSTRAINT "second_factor_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_factor_changes" ADD CONSTRAINT "second_factor_changes_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "second_factor_changes" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("second_factor_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("second_factor_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "second_factor_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "second_factor_changes" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "second_factor_changes"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
