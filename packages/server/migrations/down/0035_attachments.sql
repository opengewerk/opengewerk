-- Rolling the attachments back.
--
-- What it costs an installation that runs it: every attachment and every
-- version is gone with its table. The files themselves stay in the store and
-- in `files`, where nothing points at them any more. Run as the superuser,
-- like every rollback: the versions refuse to be deleted to everybody else.
--
-- The audit log keeps its entries about both tables, the same choice as in
-- every earlier rollback.

DROP TRIGGER IF EXISTS "attachment_versions_stay_as_written" ON "attachment_versions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "attachment_versions_record_uploader" ON "attachment_versions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "attachment_versions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "attachment_versions";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "attachment_versions";--> statement-breakpoint
DROP TABLE IF EXISTS "attachment_versions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "attachments";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "attachments";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "attachments";--> statement-breakpoint
DROP TABLE IF EXISTS "attachments";--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_version_stays_as_written"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_attachment_uploader"();
