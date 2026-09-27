-- Passkeys come back, #167 and #248: listed, renamed and deleted under
-- "Konto", added only after confirming again, and counted as the second
-- factor when they were confirmed on the device.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE, the grant and the audit trigger of the new table.
--
-- **Why a table in every business.** A passkey belongs to the account and so
-- to the instance, and `auth_passkeys` has no tenant and no audit trigger. But
-- it opens every business the person works in, and each of them should see it
-- come and go in its own log. `member_passkeys` is that: a row per passkey and
-- business, written, renamed and marked by the application, and the audit
-- trigger does the rest, as it does for `tenant_sessions`.
--
-- **Why the grant stops at UPDATE.** A deleted passkey keeps its row with
-- `removed_at`, so that the question which keys somebody ever had stays
-- answerable. The cascade from `memberships` is the one way a row goes, and
-- memberships are blocked rather than deleted.
--
-- **Why the sign in method sits on both sessions.** On `auth_sessions` because
-- the second factor is asked on every request, and a session that began with
-- a passkey carries it. On `tenant_sessions` because that is the row the
-- owner reads: a sign in with a passkey shows in the log of the business.
-- Every session before this one began with a password, hence the default.
--
-- **Why `reconfirmed_at`.** Adding a passkey asks for the password and the
-- code again within the last minutes, and the moment of that confirmation is
-- kept on the session it was made in. better-auth knows nothing of the column.
--
-- **Why a new kind of mail, and nothing done with it here.** An account is
-- told by mail about a passkey added to it, through the outbox of a business
-- it works in. All pending migrations run in one transaction, and a new value
-- of an enum may not be used in the transaction that adds it; nothing below
-- uses it, the application does from the next start on.

ALTER TYPE "public"."mail_kind" ADD VALUE 'passkey_added';--> statement-breakpoint
CREATE TYPE "public"."sign_in_method" AS ENUM('password', 'passkey');--> statement-breakpoint
CREATE TABLE "member_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"passkey_id" text NOT NULL,
	"name" text NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_passkeys_once" UNIQUE("tenant_id","passkey_id")
);
--> statement-breakpoint
ALTER TABLE "member_passkeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_passkeys" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "sign_in_method" "sign_in_method" DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "reconfirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_sessions" ADD COLUMN "sign_in_method" "sign_in_method" DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_passkeys" ADD CONSTRAINT "member_passkeys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_passkeys" ADD CONSTRAINT "member_passkeys_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_passkeys" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("member_passkeys"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("member_passkeys"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "member_passkeys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "member_passkeys" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "member_passkeys"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
