-- Takes the last day of memberships and invitations out again, back to how
-- 0074 left things.
--
-- The columns go without asking, and with them every last day a business had
-- set: those memberships run on without an end. Run as the superuser, like
-- every rollback.
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "last_day";--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN IF EXISTS "last_day";
