-- Takes the block `attachments.sql` back out. The two triggers go wherever
-- they hang, not wherever a list claims they do: the catalogue is asked, the
-- same way round as a test asks it.
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
		   AND p.proname IN ('record_attachment_uploader', 'attachment_version_stays_as_written')
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', hung.tgname, hung.relname);
	END LOOP;
END
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_version_stays_as_written"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_attachment_uploader"();
