-- Rolling tasks back.
--
-- What it costs an installation that runs it: every task is gone with its
-- table, open or done. Nothing else refers to a task, so nothing else changes.
--
-- The audit log keeps its entries about `tasks`, the same choice as in every
-- earlier rollback.

DROP TRIGGER IF EXISTS "tasks_record_author" ON "tasks";--> statement-breakpoint
DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "tasks";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tasks";--> statement-breakpoint
DROP TABLE IF EXISTS "tasks";--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_task_author"();--> statement-breakpoint
DROP TYPE IF EXISTS "public"."task_status";
