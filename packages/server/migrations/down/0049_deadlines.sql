-- Rolling the deadline engine back to how 0048 left it.
--
-- What it costs an installation that runs it: every deadline and every setting
-- of a kind, with the messages about a deadline that are still in the outbox.
-- The tasks a deadline made stay, they are tasks like any other. The audit log
-- keeps its entries about both tables, as in every earlier rollback.
--
-- PostgreSQL does not take a value out of an enum, so `mail_kind` is rebuilt
-- without it, the way 0037 does it. The rows go first, while the type still
-- knows every value.

DELETE FROM "mail_outbox" WHERE "kind" = 'deadline_due';--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP CONSTRAINT IF EXISTS "mail_outbox_deadline_in_tenant";--> statement-breakpoint
DROP INDEX IF EXISTS "mail_outbox_deadline_idx";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP COLUMN IF EXISTS "deadline_id";--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."mail_kind";--> statement-breakpoint
CREATE TYPE "public"."mail_kind" AS ENUM('task_due', 'document', 'invitation');--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" SET DATA TYPE "public"."mail_kind" USING "kind"::"public"."mail_kind";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "deadline_settings";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "deadlines";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "deadline_settings";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "deadlines";--> statement-breakpoint
DROP TABLE IF EXISTS "deadline_settings";--> statement-breakpoint
DROP TABLE IF EXISTS "deadlines";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deadline_status";
