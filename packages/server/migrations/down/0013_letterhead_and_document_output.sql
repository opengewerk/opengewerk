-- Rolling the letterhead and the document output back.
--
-- What it costs an installation that runs it: every PDF that was produced stays
-- in the file store, but nothing points at it any more, and the snapshot each
-- issued document took of itself is gone. The documents themselves stay issued
-- with their numbers, and their lines are still there, so the figures survive.
-- What does not survive is the record of the address and the letterhead they
-- were sent with, which is the part this migration exists for.
--
-- The letterhead goes with its table, and so does the period of service on
-- every document, including on the ones that were issued with one.
--
-- The audit log keeps its entries about all four tables, the same choice as in
-- every earlier rollback: taking entries out of the middle of the chain would
-- turn a sound log into one that reports a break.

DROP TRIGGER IF EXISTS "document_files_stay_as_written" ON "document_files";--> statement-breakpoint
DROP TRIGGER IF EXISTS "document_snapshots_stay_as_written" ON "document_snapshots";--> statement-breakpoint
DROP FUNCTION IF EXISTS "stays_as_written"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "audit_changes" ON "document_files";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "document_snapshots";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "letterheads";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "files";--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_isolation" ON "document_files";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "document_snapshots";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "letterheads";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "files";--> statement-breakpoint

DROP TABLE IF EXISTS "document_files";--> statement-breakpoint
DROP TABLE IF EXISTS "document_snapshots";--> statement-breakpoint
DROP TABLE IF EXISTS "letterheads";--> statement-breakpoint
DROP TABLE IF EXISTS "files";--> statement-breakpoint

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_service_period";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "service_until";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "service_from";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."document_file_purpose";
