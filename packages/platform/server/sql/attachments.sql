-- The versions of a file in the records of a tenant: what keeps one as it was
-- written. The two tables come from the schema of an application that keeps
-- such files (`attachmentsSchema`), and the triggers that call these functions
-- from the description of the table of versions; in here are the functions.
--
-- A new version is a new row, and an old one stays readable. The grant of the
-- application role stops at INSERT, and the second function refuses the rest
-- to everybody, the owner of the table included, like a signature.

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

-- Refuses every change and every deletion, whoever asks. A version whose hash
-- could be changed afterwards would show somebody a different file than the
-- one a decision was taken on.
CREATE FUNCTION "attachment_version_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Fassung einer Datei wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;
