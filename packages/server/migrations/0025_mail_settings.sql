-- The mail server of each business, set up in the office instead of in the .env
-- of the instance, and the signature under what the business sends.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grants, and the audit trigger on
-- `mail_settings`.
--
-- **Why `secrets` has no audit trigger.** It holds the sealed password of the
-- mailbox, and the log is written once and never touched again: a sealed
-- password in it would stay there for good, open to anybody who later holds
-- the log and the key together. The log learns when a password was set from
-- `mail_settings.password_set_at` instead, with who set it. `audit.test.ts`
-- names this table as the one exception, so that the next one is a decision
-- as well.
--
-- **Why DELETE on both.** A business that stops sending mail removes its mail
-- server, and with it the login; keeping a password nobody uses is the one
-- thing worse than keeping one somebody does.

CREATE TYPE "public"."mail_security" AS ENUM('starttls', 'tls', 'none');--> statement-breakpoint
CREATE TYPE "public"."secret_purpose" AS ENUM('smtp_password');--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" "mail_security" NOT NULL,
	"username" text,
	"from_address" text NOT NULL,
	"signature" text,
	"password_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" "secret_purpose" NOT NULL,
	"sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_one_per_purpose" UNIQUE("tenant_id","purpose")
);
--> statement-breakpoint
ALTER TABLE "secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_settings_tenant" ON "mail_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mail_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("mail_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("mail_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "secrets" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("secrets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("secrets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mail_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "secrets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mail_settings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "secrets" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "mail_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
