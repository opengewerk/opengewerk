-- Takes the records of new passwords and of changes of the mail server of the
-- instance out again, back to how 0083 left things.
--
-- The rows go without asking. What they said is in the audit log, which keeps
-- its entries about the tables, the same choice as in every earlier rollback.
--
-- Run as the superuser, like every rollback.
DROP TRIGGER IF EXISTS "audit_changes" ON "account_mail_server_changes";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "account_mail_server_changes";--> statement-breakpoint
DROP TABLE IF EXISTS "account_mail_server_changes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "password_resets";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "password_resets";--> statement-breakpoint
DROP TABLE IF EXISTS "password_resets";
