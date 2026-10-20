-- The versions of a file in the records of a tenant: what keeps one as it was
-- written. The two tables come from the schema of an application that keeps
-- such files (`attachmentsSchema`), and the triggers that call these functions
-- from the description of the table of versions; in here are the functions.
--
-- A new version is a new row, and an old one stays readable. The grant of the
-- application role stops at INSERT and DELETE, and the second function refuses
-- every change to everybody, the owner of the table included, like a
-- signature, and every deletion but one: a document that goes for good on the
-- way an application opens for it (opengewerk/opengewerk#658), at the end of a
-- retention. Then the file of a version goes as well, the row of the tenant in
-- `files`, once nothing else names it.
--
-- Everything that reads a table of the records is plpgsql: these functions
-- stand in every database the blocks build, also in one without such tables.

-- Who stored the version, from the request and from nothing else: who and
-- when is what the metadata of a file has to say.
CREATE FUNCTION "record_attachment_uploader"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.created_by := nullif(current_setting('app.user_id', true), '');

	RETURN new;
END;
$$;--> statement-breakpoint

-- Whether the application lets this document go for good now (#658). The
-- foundation does not know when a document may go; an application that lets
-- one go defines `application_attachment_may_go(uuid)` in a migration of its
-- own and answers there, from what this transaction has done. Without it,
-- nothing goes.
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

-- Whether this document is going for good in this very statement: what
-- `purge_attachment` is doing, and what the application allows. The locks
-- let a deletion through on it, and the log writes nothing then.
CREATE FUNCTION "attachment_purging"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_attachment IS NOT NULL
	   AND coalesce(current_setting('app.purging_attachment', true), '') = p_attachment::text
	   AND public.attachment_may_go(p_attachment)
$$;--> statement-breakpoint

-- Refuses every change and every deletion, whoever asks, but the deletion of
-- the versions of a document that goes for good. A version whose hash could be
-- changed afterwards would show somebody a different file than the one a
-- decision was taken on.
CREATE FUNCTION "attachment_version_stays_as_written"() RETURNS trigger
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

-- A file of a tenant goes only while a document goes for good, with the last
-- version that named it (#658); whether anything else still names it, the
-- keys onto `files` decide, also in areas the person who asks does not see.
CREATE FUNCTION "file_goes_with_its_document"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	purging text := nullif(current_setting('app.purging_attachment', true), '');
BEGIN
	IF purging IS NOT NULL AND public.attachment_purging(purging::uuid) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Datei geht nur mit dem Dokument, das sie als Letztes nennt.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint

-- Lets a document go for good (#658), on the way the application opens for it
-- (`application_attachment_may_go`) and nowhere else: its versions go, and so
-- does the file of each version in `files` once nothing else names it, who
-- stored it with it; the document stays as a row marked as deleted under the
-- title the application gives, so that a device that was offline learns that
-- it is gone. Run as whoever asks, in their transaction: what the policies
-- show is what goes. Says how many files went.
CREATE FUNCTION "purge_attachment"(p_attachment uuid, p_title text) RETURNS integer
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	tenant uuid;
	named text[];
	hash text;
	before text := current_setting('app.purging_attachment', true);
	gone integer := 0;
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

	FOREACH hash IN ARRAY named LOOP
		BEGIN
			DELETE FROM public.files WHERE tenant_id = tenant AND sha256 = hash;

			IF FOUND THEN
				gone := gone + 1;
			END IF;
		EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
			-- Another record still names the file, and it stays.
			NULL;
		END;
	END LOOP;

	PERFORM set_config('app.purging_attachment', coalesce(before, ''), true);

	RETURN gone;
END;
$$;
