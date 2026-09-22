-- Rolling back documents sent by mail.
--
-- The columns go, and the kind of message with them, which PostgreSQL only
-- allows by building the type anew. A message about a document blocks the
-- cast, and that is the right way round: it records that an invoice went to a
-- customer, and a rollback that quietly dropped it would rewrite what happened.
DROP INDEX IF EXISTS "mail_outbox_document_idx";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP COLUMN IF EXISTS "requested_by";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP COLUMN IF EXISTS "attachment";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP COLUMN IF EXISTS "document_id";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mail_attachment";--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" TYPE text;--> statement-breakpoint
DROP TYPE "public"."mail_kind";--> statement-breakpoint
CREATE TYPE "public"."mail_kind" AS ENUM('task_due');--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "kind" TYPE "public"."mail_kind" USING "kind"::"public"."mail_kind";
