-- Takes the corrections of accounts out again, back to how 0069 left things.
--
-- The rows go without asking. What they said is in the audit log, which keeps
-- its entries about the table, the same choice as in every earlier rollback.
-- The names and addresses that were corrected stay as they are now.
--
-- Run as the superuser, like every rollback.
DROP TRIGGER IF EXISTS "audit_changes" ON "account_corrections";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "account_corrections";--> statement-breakpoint
DROP TABLE IF EXISTS "account_corrections";
