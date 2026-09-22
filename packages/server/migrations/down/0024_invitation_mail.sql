-- Rolling back invitations sent by mail.
--
-- The column goes, and the kind of message with it, which PostgreSQL only
-- allows by building the type anew. A message about an invitation blocks the
-- cast: it records that somebody was invited, and a rollback that quietly
-- dropped it would rewrite that.
DROP INDEX IF EXISTS "mail_outbox_invitation_idx";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP COLUMN IF EXISTS "invitation_id";--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" TYPE text;--> statement-breakpoint
DROP TYPE "public"."mail_kind";--> statement-breakpoint
CREATE TYPE "public"."mail_kind" AS ENUM('task_due', 'document');--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" TYPE "public"."mail_kind" USING "kind"::"public"."mail_kind";
