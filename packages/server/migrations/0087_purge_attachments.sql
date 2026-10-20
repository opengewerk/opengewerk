-- A document and its files go for good at the end of a retention
-- (opengewerk/opengewerk#658), on the way an application opens for it and
-- nowhere else; the statements are the block `attachments.sql` of the
-- foundation and the descriptions of its tables.
--
-- - `purge_attachment(document, title)` deletes the versions of a document,
--   leaves the document as a row marked as deleted under the title it is
--   given, so that a device that was offline learns that it is gone, and
--   deletes the row of each file in `files` once no key names it any more.
--   Who stored a file goes with it (`file_uploads`, now ON DELETE CASCADE).
-- - The business decides when: a migration of its own defines
--   `application_attachment_may_go(uuid)`. Without it, which is the case here,
--   nothing goes, and the locks refuse every deletion of a version or a file
--   to everybody, the owner of the tables included.
-- - The log writes nothing when a document goes this way: its triggers on
--   the two tables are split into one for what is inserted and one for the
--   rest, which asks `attachment_purging`.
-- - The application role may DELETE on `attachment_versions`, and the lock
--   there decides. It may not delete in `files`: the trigger after the
--   deletion of a version takes its files, as the owner of the tables
--   (`version_takes_its_files`, policy `deletable_by_the_owner`), and the
--   lock on `files` lets only the file through that this trigger names.
--
-- The new key is checked against every row, so both tables leave FORCE for
-- the statement, as 0051 did.
ALTER TABLE "files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_uploads" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT "file_uploads_file_in_tenant";--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_in_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "deletable_by_the_owner" ON "files" AS PERMISSIVE FOR DELETE TO current_user USING (true);--> statement-breakpoint
ALTER TABLE "file_uploads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION "attachment_may_go"(p_attachment uuid) RETURNS boolean
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	allowed boolean;
BEGIN
	IF p_attachment IS NULL OR to_regprocedure('public.application_attachment_may_go(uuid)') IS NULL THEN
		RETURN false;
	END IF;

	EXECUTE 'SELECT public.application_attachment_may_go($1)' INTO allowed USING p_attachment;

	RETURN coalesce(allowed, false);
END;
$$;--> statement-breakpoint
CREATE FUNCTION "attachment_purging"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_attachment IS NOT NULL
	   AND coalesce(current_setting('app.purging_attachment', true), '') = p_attachment::text
	   AND public.attachment_may_go(p_attachment)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "attachment_version_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP = 'DELETE' AND public.attachment_purging(old.attachment_id) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Fassung einer Datei wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "file_goes_with_its_document"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF coalesce(current_setting('app.taking_file', true), '') = old.tenant_id::text || '/' || old.sha256 THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Datei geht nur mit dem Dokument, das sie als Letztes nennt.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "version_takes_its_files"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	hash text;
BEGIN
	IF coalesce(current_setting('app.purging_attachment', true), '') <> old.attachment_id::text THEN
		RETURN NULL;
	END IF;

	FOREACH hash IN ARRAY ARRAY[old.sha256, old.preview_sha256] LOOP
		CONTINUE WHEN hash IS NULL;

		PERFORM set_config('app.taking_file', old.tenant_id::text || '/' || hash, true);

		BEGIN
			DELETE FROM public.files WHERE tenant_id = old.tenant_id AND sha256 = hash;
		EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
			-- Another record still names the file, and it stays.
			NULL;
		END;
	END LOOP;

	PERFORM set_config('app.taking_file', '', true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "purge_attachment"(p_attachment uuid, p_title text) RETURNS integer
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	tenant uuid;
	named text[];
	before text := current_setting('app.purging_attachment', true);
	left_over integer;
BEGIN
	IF NOT public.attachment_may_go(p_attachment) THEN
		RAISE EXCEPTION 'Ein Dokument wird nur auf dem Weg endgültig gelöscht, den die Anwendung dafür öffnet.'
			USING ERRCODE = 'OG001';
	END IF;

	EXECUTE 'SELECT tenant_id FROM public.attachments WHERE id = $1' INTO tenant USING p_attachment;

	IF tenant IS NULL THEN
		RETURN 0;
	END IF;

	PERFORM set_config('app.purging_attachment', p_attachment::text, true);

	EXECUTE 'SELECT coalesce(array_agg(DISTINCT named.hash), ''{}'')
	           FROM (SELECT sha256 AS hash FROM public.attachment_versions WHERE attachment_id = $1
	                 UNION
	                 SELECT preview_sha256 FROM public.attachment_versions
	                  WHERE attachment_id = $1 AND preview_sha256 IS NOT NULL) AS named'
	   INTO named USING p_attachment;

	EXECUTE 'DELETE FROM public.attachment_versions WHERE attachment_id = $1' USING p_attachment;
	EXECUTE 'UPDATE public.attachments SET title = $2, deleted_at = coalesce(deleted_at, now()) WHERE id = $1'
	  USING p_attachment, p_title;

	SELECT count(*) INTO left_over FROM public.files WHERE tenant_id = tenant AND sha256 = ANY (named);

	PERFORM set_config('app.purging_attachment', coalesce(before, ''), true);

	RETURN cardinality(named) - left_over;
END;
$$;--> statement-breakpoint
GRANT DELETE ON "attachment_versions" TO "opengewerk_app";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "attachments";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_purged" AFTER UPDATE OR DELETE ON "attachments"
	FOR EACH ROW WHEN (NOT (public.attachment_purging(old.id))) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "attachment_versions";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_purged" AFTER UPDATE OR DELETE ON "attachment_versions"
	FOR EACH ROW WHEN (NOT (public.attachment_purging(old.attachment_id))) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "attachment_versions_take_their_files" AFTER DELETE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "version_takes_its_files"();--> statement-breakpoint
CREATE TRIGGER "files_go_with_their_document" BEFORE DELETE ON "files"
	FOR EACH ROW EXECUTE FUNCTION "file_goes_with_its_document"();
