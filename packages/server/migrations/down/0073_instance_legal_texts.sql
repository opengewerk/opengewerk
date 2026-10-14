-- Takes the legal texts of the instance out again, back to how 0072 left
-- things.
--
-- The columns go without asking, the texts with them. What the log of the
-- instance said about them it keeps. After this the foot of the sign in links
-- to no legal text until a version is running that keeps them some other way.
--
-- Run as the superuser, like every rollback.
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "privacy_notice";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "imprint";
