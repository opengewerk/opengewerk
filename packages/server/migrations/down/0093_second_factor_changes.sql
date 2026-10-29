-- Takes the record of changes of the second factor out again, back to how
-- 0092 left things.
--
-- The rows go without asking. What they said is in the audit log, which keeps
-- its entries about the table, the same choice as in every earlier rollback.
--
-- Run as the superuser, like every rollback.
DROP TRIGGER IF EXISTS "audit_changes" ON "second_factor_changes";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "second_factor_changes";--> statement-breakpoint
DROP TABLE IF EXISTS "second_factor_changes";
