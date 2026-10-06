-- The labels with a QR code: what keeps a blocked one blocked. The table comes
-- from the schema of an application that prints such labels (`labelColumns`),
-- with the keys of what a label of its own hangs on, and the application hangs
-- this function on it as a trigger `BEFORE UPDATE OF blocked_at`; in here is
-- the function.
--
-- A label is blocked because it was lost or stuck on the wrong thing. One that
-- could be opened again would open whatever it was stuck on, for whoever
-- found it.
CREATE FUNCTION "keep_label_blocked"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.blocked_at IS NOT NULL AND new.blocked_at IS DISTINCT FROM old.blocked_at THEN
		RAISE EXCEPTION 'Ein gesperrtes Etikett bleibt gesperrt.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN new;
END;
$$;
