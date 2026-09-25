-- Rolling the notes from the site back to how 0044 left them.
--
-- What it costs an installation that runs it: every note written on site,
-- which is what happened at a job and nowhere else written down. The rollback
-- therefore stops while there is a single note.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "job_notes") THEN
		RAISE EXCEPTION 'Es gibt Notizen von der Baustelle. Sie stehen nirgends sonst; die Rücknahme bricht ab, damit keine verloren geht.';
	END IF;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "job_notes_record_author" ON "job_notes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "job_notes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "job_notes";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "job_notes";--> statement-breakpoint
DROP TABLE IF EXISTS "job_notes";--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_note_author"();
