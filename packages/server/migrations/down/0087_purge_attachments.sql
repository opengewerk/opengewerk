-- Back to how 0086 left things: no document and no file goes for good,
-- the versions keep their lock of before, the log hangs on the two tables as one
-- trigger again, and who stored a file stops the file from going.
--
-- Run as the superuser, like every rollback.
DROP TRIGGER IF EXISTS "files_go_with_their_document" ON "files";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes_unless_purged" ON "attachment_versions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "attachment_versions";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes_unless_purged" ON "attachments";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "attachments";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
REVOKE DELETE ON "files" FROM "opengewerk_app";--> statement-breakpoint
REVOKE DELETE ON "attachment_versions" FROM "opengewerk_app";--> statement-breakpoint
DROP FUNCTION IF EXISTS "purge_attachment"(uuid, text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "file_goes_with_its_document"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "attachment_version_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Fassung einer Datei wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_purging"(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_may_go"(uuid);--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT "file_uploads_file_in_tenant";--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_in_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;
