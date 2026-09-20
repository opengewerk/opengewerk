-- Takes the first run setup back out. The business and the account it created
-- stay: this undoes the way in, not what somebody did with it.
DROP FUNCTION IF EXISTS "create_first_tenant"(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "instance_is_empty"();--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "no_application_insert" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "created_by_setup" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "auth_users";
