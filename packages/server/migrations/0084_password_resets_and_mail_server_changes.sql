-- Two records every business keeps of what happens to the ways into it from
-- outside it (found in the security review, opengewerk-haustechnik#360).
--
-- The link to a new password goes out through the mail server of the instance,
-- which whoever runs the instance sets up, and whoever sets it up could read
-- the links there. Until now neither a new password nor a new mail server
-- stood anywhere a business could see. From now on:
--
-- **`password_resets`**: a row per reset of a password and business the account
-- works in, through the link or `reset-password` on the server: whose and
-- when, never the link or its token. The newest row of an account is also how
-- long it waits before it sets up a second factor or a passkey.
--
-- **`account_mail_server_changes`**: a row in every business per change of the
-- mail server of the instance: the server and the address it sent from before
-- and after, a pair of nulls on the side where there was none. Never the login
-- or its password.
--
-- Both tables are the foundation's; every application adds them with a
-- migration of its own. Everything down to the policies comes from the schema.
-- What follows them is written by hand: FORCE, the grant and the audit trigger
-- of each table. A row says what happened at one moment, so the grant stops at
-- INSERT.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this migration runs on unchanged; it writes no such rows.
CREATE TABLE "account_mail_server_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host_before" text,
	"from_before" text,
	"host_after" text,
	"from_after" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_mail_server_changes_before_in_a_pair" CHECK (("account_mail_server_changes"."host_before" is null) = ("account_mail_server_changes"."from_before" is null)),
	CONSTRAINT "account_mail_server_changes_after_in_a_pair" CHECK (("account_mail_server_changes"."host_after" is null) = ("account_mail_server_changes"."from_after" is null)),
	CONSTRAINT "account_mail_server_changes_names_a_server" CHECK ("account_mail_server_changes"."host_before" is not null or "account_mail_server_changes"."host_after" is not null)
);
--> statement-breakpoint
ALTER TABLE "account_mail_server_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reset_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_mail_server_changes" ADD CONSTRAINT "account_mail_server_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_resets_person_idx" ON "password_resets" USING btree ("tenant_id","user_id","reset_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account_mail_server_changes" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("account_mail_server_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("account_mail_server_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "password_resets" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("password_resets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("password_resets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "password_resets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "password_resets" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "password_resets"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

ALTER TABLE "account_mail_server_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "account_mail_server_changes" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "account_mail_server_changes"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
