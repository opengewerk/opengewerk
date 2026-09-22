-- Rolling back the choices on documents about their instructions.
--
-- What it costs an installation that runs it: every draft forgets what was
-- switched on or off and which kind of contract was chosen, and follows the
-- proposal again as a contract about work. What an issued document carried
-- stays in its snapshot, which this does not touch.
--
-- The audit log keeps its entries, the same choice as in every earlier
-- rollback.

DROP TRIGGER IF EXISTS "audit_changes" ON "document_instruction_choices";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "document_instruction_choices";--> statement-breakpoint
DROP TABLE IF EXISTS "document_instruction_choices";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."withdrawal_variant";
