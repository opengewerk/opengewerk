-- Takes the two limits of a business out of the settings of the instance
-- again, back to how 0093 left things. What they were set to is in the log of
-- the instance.
--
-- Run as the superuser, like every rollback.
ALTER TABLE "instance_settings" DROP CONSTRAINT IF EXISTS "instance_settings_tenant_storage";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "own_tenants_allowed";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "tenant_storage_bytes";
