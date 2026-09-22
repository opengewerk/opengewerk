-- Rolling instructions back.
--
-- What it costs an installation that runs it: every instruction is gone with
-- its table, the ones the business wrote and the shipped ones it changed or
-- set up for itself. Nothing else refers to an instruction, so nothing else
-- changes.
--
-- The audit log keeps its entries about `instructions`, the same choice as in
-- every earlier rollback.

DROP TRIGGER IF EXISTS "audit_changes" ON "instructions";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "instructions";--> statement-breakpoint
DROP TABLE IF EXISTS "instructions";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."instruction_template";
