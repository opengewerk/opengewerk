-- Rolling push back to how 0049 left it.
--
-- What it costs an installation that runs it: every device that takes push
-- messages, every occasion somebody switched off and every message, sent or
-- waiting. The browsers keep their subscriptions and get nothing more; switched
-- on again after an update, they are asked once more. The audit log keeps its
-- entries about the three tables, as in every earlier rollback.

DROP TRIGGER IF EXISTS "audit_changes" ON "push_outbox";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "push_opt_outs";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "push_subscriptions";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "push_outbox";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "push_opt_outs";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "push_subscriptions";--> statement-breakpoint
DROP TABLE IF EXISTS "push_outbox";--> statement-breakpoint
DROP TABLE IF EXISTS "push_opt_outs";--> statement-breakpoint
DROP TABLE IF EXISTS "push_subscriptions";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."push_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."push_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."push_entry";
