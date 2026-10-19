-- Takes part B of the measures and the subprocessors of the instance out
-- again, back to how 0078 left things.
--
-- The columns go without asking, what was kept in them with them. What the
-- log of the instance said about them it keeps.
--
-- Run as the superuser, like every rollback.
ALTER TABLE "instance_settings" DROP CONSTRAINT IF EXISTS "instance_settings_subprocessors_list";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP CONSTRAINT IF EXISTS "instance_settings_measures_object";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "subprocessors";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "measures";
