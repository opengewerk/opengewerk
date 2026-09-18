-- Die Ruecknahme zu 0003_audit_log.sql.

DROP TRIGGER IF EXISTS "audit_entries_stay_on_truncate" ON "audit_entries";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_entries_stay" ON "audit_entries";--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_entry_stays"();--> statement-breakpoint

-- Dieselbe Frage an den Katalog wie beim Anlegen, nur andersherum: weg kommt
-- der Trigger ueberall dort, wo er haengt, nicht dort, wo eine Liste es
-- behauptet.
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

DROP FUNCTION IF EXISTS "record_change"();--> statement-breakpoint

DROP POLICY IF EXISTS "written_by_trigger" ON "audit_entries";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "audit_entries";--> statement-breakpoint
DROP TABLE IF EXISTS "audit_entries";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."audit_operation";
