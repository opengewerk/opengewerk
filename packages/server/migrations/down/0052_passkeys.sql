-- Rolling passkeys back to how 0051 left them.
--
-- What it costs an installation that runs it: every passkey, and with them the
-- way in of anybody who signs in with one and has forgotten the password. The
-- rollback therefore stops while there is a single passkey; delete them under
-- "Konto" first, which leaves the password to sign in with. The rows of
-- `member_passkeys` go without asking, their history is in the audit log, and
-- so do the mails about a new passkey that are still in the outbox.
--
-- PostgreSQL does not take a value out of an enum, so `mail_kind` is rebuilt
-- without it, the way 0049 does it. The rows go first, while the type still
-- knows every value.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "auth_passkeys") THEN
		RAISE EXCEPTION 'Es gibt noch Passkeys. Bitte zuerst unter „Konto“ löschen; das Passwort meldet danach weiter an.';
	END IF;
END
$$;--> statement-breakpoint
DELETE FROM "mail_outbox" WHERE "kind" = 'passkey_added';--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."mail_kind";--> statement-breakpoint
CREATE TYPE "public"."mail_kind" AS ENUM('task_due', 'document', 'invitation', 'deadline_due');--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" SET DATA TYPE "public"."mail_kind" USING "kind"::"public"."mail_kind";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "member_passkeys";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "member_passkeys";--> statement-breakpoint
DROP TABLE IF EXISTS "member_passkeys";--> statement-breakpoint
ALTER TABLE "tenant_sessions" DROP COLUMN IF EXISTS "sign_in_method";--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "reconfirmed_at";--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "sign_in_method";--> statement-breakpoint
ALTER TABLE "auth_passkeys" DROP COLUMN IF EXISTS "last_used_at";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."sign_in_method";
