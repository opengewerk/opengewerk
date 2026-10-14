-- Takes the way a kind reminds out again, back to how 0073 left things.
--
-- The column goes without asking, and with it what a business had set: its
-- deadlines remind by mail and by push again. Run as the superuser, like
-- every rollback.
ALTER TABLE "deadline_settings" DROP CONSTRAINT IF EXISTS "deadline_settings_reminder_known";--> statement-breakpoint
ALTER TABLE "deadline_settings" DROP COLUMN IF EXISTS "reminder";
