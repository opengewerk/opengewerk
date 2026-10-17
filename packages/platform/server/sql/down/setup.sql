-- Takes the block `setup.sql` back out. A tenant and an account that were
-- created through it stay: this undoes the way in, not what somebody did with
-- it.
DROP FUNCTION IF EXISTS "every_tenant"();--> statement-breakpoint
-- The trigger on the roles goes wherever it hangs, not wherever a list claims
-- it does: the catalogue is asked, as in `attachments.sql`. Then its function.
DO $$
DECLARE
	hung record;
BEGIN
	FOR hung IN
		SELECT c.relname, t.tgname
		  FROM pg_trigger t
		  JOIN pg_class c ON c.oid = t.tgrelid
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		  JOIN pg_proc p ON p.oid = t.tgfoid
		 WHERE n.nspname = 'public'
		   AND NOT t.tgisinternal
		   AND p.proname = 'tenant_role_stays_whole'
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', hung.tgname, hung.relname);
	END LOOP;
END
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "tenant_role_stays_whole"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "invitation_for"(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "create_first_tenant"(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "instance_is_empty"();
