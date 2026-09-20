-- Anmeldung und Sitzungen nach ADR 0006.
--
-- Two kinds of table arrive together here, and telling them apart is the whole
-- design.
--
-- The `auth_` ones are better-auth's: users, sessions, passwords, passkeys,
-- the second factor. A user belongs to the instance and not to a business, so
-- these carry no `tenant_id`. That has two consequences the rest of this file
-- is made of.
--
--   * They get no audit trigger. The trigger takes the tenant from the row and
--     writes it into a column that cannot be null, so a row without one would
--     make every sign up fail on a foreign key. Their exclusion is by prefix,
--     like the sync layer's, so the next such table is covered too.
--   * Their policy is the usual one turned around: a row is in reach only
--     while no tenant is set. `forTenant` always sets one and `forInstance`
--     never does, so business data and accounts sit in two halves that cannot
--     see each other. Without this, a request working inside one company could
--     read the staff list of the company next door on the same instance.
--
-- The other two, `memberships` and `tenant_sessions`, do carry a tenant and are
-- ordinary tables in every respect, trigger included. That is deliberate and it
-- is where ADR 0006 gets the audit entries it asks for: a change of rights is a
-- change to a membership, and signing in to a business writes a tenant session
-- and closing it ends one. Neither needed a line of code, because the trigger
-- from 0003 already watches every table that has a tenant.
--
-- Why a sign in cannot be logged any earlier: an audit entry needs a tenant,
-- and between typing a password and picking a company there is none. So the
-- instance knows somebody signed in and no company does, until one is chosen.
--
-- `tenants` gets a second policy for the same reason. Somebody who belongs to
-- two companies is asked to pick one before any tenant is set, and without it
-- that list would be empty: a company has to be readable by name from outside
-- one, and exactly as far as the membership reaches.
--
-- Below FORCE are the three lines drizzle-kit never writes and every new table
-- needs again, plus the trigger for the two that get one.

CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_passkeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_tenant_id" uuid,
	"device_id" text,
	"long_lived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_two_factors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "auth_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"roles" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_one_per_user" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"device_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_passkeys" ADD CONSTRAINT "auth_passkeys_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_sessions" ADD CONSTRAINT "tenant_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_sessions" ADD CONSTRAINT "tenant_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "own_tenants_outside_tenant" ON "tenants" AS PERMISSIVE FOR SELECT TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null
      and exists (
        select 1 from memberships m
         where m.tenant_id = "tenants"."id"
           and m.user_id = nullif(current_setting('app.user_id', true), '')
      ));--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_accounts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_passkeys" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_rate_limits" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_sessions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_two_factors" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_users" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_verifications" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("memberships"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("memberships"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "own_membership_outside_tenant" ON "memberships" AS PERMISSIVE FOR SELECT TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null
        and "memberships"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_sessions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tenant_sessions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_sessions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "auth_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_two_factors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_passkeys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_rate_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The application writes all of these. It is the only thing that ever touches
-- the `auth_` tables, and it reaches them only outside a tenant transaction,
-- which the policy above is what enforces.
--
-- DELETE is granted where rows genuinely go away: a session ends, a passkey is
-- removed, a verification expires, a rate limit window is swept. It is withheld
-- from `auth_users`, because a user with work behind them is not deleted but
-- stopped, and from `memberships` and `tenant_sessions`, where a removed row
-- would take a piece of the audit trail with it. Taking somebody's rights away
-- is an update to the roles, and it stays in the log.
GRANT SELECT, INSERT, UPDATE ON "auth_users" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_sessions" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_accounts" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_verifications" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_two_factors" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_passkeys" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_rate_limits" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "memberships" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_sessions" TO "opengewerk_app";--> statement-breakpoint

-- Only the two that have a tenant. The `auth_` tables are left out on purpose,
-- see the top of this file.
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "memberships"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tenant_sessions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
