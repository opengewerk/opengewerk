-- Takes the block `instance.sql` back out: the functions and the triggers. The
-- tables go with the schema, and the row of settings and the log with them.
DROP FUNCTION IF EXISTS "tenants_with_leads"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "create_tenant"(text);--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes" ON "tenants";--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes" ON "instance_settings";--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes" ON "instance_operators";--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_instance_change"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes_stay_on_truncate" ON "instance_changes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes_stay" ON "instance_changes";--> statement-breakpoint
DROP FUNCTION IF EXISTS "instance_change_stays"();
