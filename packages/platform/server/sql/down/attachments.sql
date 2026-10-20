-- Takes the block `attachments.sql` back out. The triggers go wherever they
-- hang, not wherever a list claims they do: the catalogue is asked, the same
-- way round as a test asks it. That includes the half of the log that asks
-- whether a document is going for good (#658).
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
		   AND (p.proname IN ('record_attachment_uploader', 'attachment_version_stays_as_written',
		                      'file_goes_with_its_document', 'version_takes_its_files')
		        OR t.tgname = 'audit_changes_unless_purged')
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', hung.tgname, hung.relname);
	END LOOP;
END
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "purge_attachment"(uuid, text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "version_takes_its_files"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "file_goes_with_its_document"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_version_stays_as_written"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_purging"(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_may_go"(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_attachment_uploader"();
