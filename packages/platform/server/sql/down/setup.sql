-- Takes the block `setup.sql` back out. A tenant and an account that were
-- created through it stay: this undoes the way in, not what somebody did with
-- it.
DROP FUNCTION IF EXISTS "every_tenant"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "invitation_for"(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "create_first_tenant"(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "instance_is_empty"();
