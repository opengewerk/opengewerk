-- Takes the block `audit.sql` back out, before the tables it stands on.
DROP TRIGGER IF EXISTS "audit_entries_stay_on_truncate" ON "audit_entries";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_entries_stay" ON "audit_entries";--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_entry_stays"();--> statement-breakpoint

-- The same question to the catalogue as for the sync columns: the trigger
-- goes wherever it hangs.
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
		   AND t.tgname = 'audit_changes'
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS "audit_changes" ON %I', target);
	END LOOP;
END
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "verify_audit_chain"(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_change"();--> statement-breakpoint

-- Before the table, not after it. The fingerprint takes a row of audit_entries
-- as its argument, so the table type is part of its signature and PostgreSQL
-- refuses to drop the table while it exists.
DROP FUNCTION IF EXISTS "audit_fingerprint"(public.audit_entries);
