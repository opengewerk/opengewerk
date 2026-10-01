-- Takes the block `sync.sql` back out. The trigger goes wherever it hangs, not
-- wherever a list claims it does: the catalogue is asked, the same way round
-- as a test asks it.
DO $$
DECLARE
	target text;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_trigger t
		  JOIN pg_class c ON c.oid = t.tgrelid
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public'
		   AND t.tgname = 'stamp_sync_columns'
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS "stamp_sync_columns" ON %I', target);
	END LOOP;
END
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "stamp_sync_columns"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "next_sync_sequence"(uuid);
