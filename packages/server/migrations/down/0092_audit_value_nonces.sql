-- Takes the nonces of the values out again and puts the functions of the log
-- back as 0091 left them. Run as the superuser, like every rollback.
--
-- What it costs an installation that runs it: an entry of version 3 nobody
-- blacked out still checks through, because the check from before looks at
-- the values only of version 2 and of entries with a redaction; an entry of
-- version 3 with a value blacked out is reported as changed, since its other
-- value no longer fits a fingerprint without its nonce. A value that was
-- blacked out stays gone. Take a backup before.
CREATE OR REPLACE FUNCTION "audit_redaction_applied"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
BEGIN
	PERFORM set_config('app.redacting', new.entry_id::text || ':' || new.side, true);

	UPDATE public.audit_entries e
	   SET old_value = CASE WHEN new.side = 'old' THEN NULL ELSE e.old_value END,
	       new_value = CASE WHEN new.side = 'new' THEN NULL ELSE e.new_value END,
	       old_value_digest = coalesce(e.old_value_digest, public.audit_value_digest(e.old_value)),
	       new_value_digest = coalesce(e.new_value_digest, public.audit_value_digest(e.new_value))
	 WHERE e.id = new.entry_id;

	PERFORM set_config('app.redacting', '', true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "record_change"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	before_row jsonb := '{}'::jsonb;
	after_row jsonb := '{}'::jsonb;
	present jsonb;
	chain public.audit_chains;
	entry public.audit_entries;
	place bigint;
	previous text;
	changed text;
BEGIN
	IF tg_op <> 'INSERT' THEN
		before_row := to_jsonb(old);
	END IF;

	IF tg_op <> 'DELETE' THEN
		after_row := to_jsonb(new);
	END IF;

	present := CASE WHEN tg_op = 'DELETE' THEN before_row ELSE after_row END;

	entry.tenant_id := coalesce(present ->> 'tenant_id', present ->> 'id')::uuid;
	entry.record_id := (present ->> 'id')::uuid;
	entry.change_id := uuidv7();
	entry.table_name := tg_table_name;
	entry.operation := lower(tg_op)::public.audit_operation;
	entry.changed_at := now();
	entry.user_id := nullif(current_setting('app.user_id', true), '');
	entry.reason := nullif(current_setting('app.reason', true), '');
	entry.database_role := session_user;
	entry.fingerprint_version := 2;

	INSERT INTO public.audit_chains (tenant_id)
	VALUES (entry.tenant_id)
	ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
	RETURNING * INTO chain;

	place := chain.next_sequence;
	previous := chain.head_hash;

	FOR changed IN
		SELECT k.field
		  FROM jsonb_object_keys(before_row || after_row) AS k(field)
		 WHERE NOT (k.field = ANY (ARRAY['updated_at', 'updated_by', 'version', 'change_sequence']))
		   AND (before_row ->> k.field) IS DISTINCT FROM (after_row ->> k.field)
		 ORDER BY k.field
	LOOP
		entry.id := uuidv7();
		entry.sequence := place;
		entry.previous_hash := previous;
		entry.field := changed;
		entry.old_value := before_row ->> changed;
		entry.new_value := after_row ->> changed;
		entry.old_value_digest := public.audit_value_digest(entry.old_value);
		entry.new_value_digest := public.audit_value_digest(entry.new_value);
		entry.hash := public.audit_fingerprint(entry);

		INSERT INTO public.audit_entries VALUES (entry.*);

		previous := entry.hash;
		place := place + 1;
	END LOOP;

	IF place <> chain.next_sequence THEN
		UPDATE public.audit_chains
		   SET next_sequence = place, head_hash = previous, updated_at = now()
		 WHERE tenant_id = entry.tenant_id;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_entry_problem"(entry public.audit_entries) RETURNS text
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	kept_witness text;
	is_redacted boolean;
BEGIN
	SELECT max(r.witness), count(*) > 0 INTO kept_witness, is_redacted
	  FROM public.audit_redactions r
	 WHERE r.entry_id = entry.id;

	IF entry.fingerprint_version = 1 AND is_redacted THEN
		IF kept_witness IS DISTINCT FROM public.audit_witness(entry) THEN
			RETURN 'Der Eintrag wurde nach dem Schwärzen verändert.';
		END IF;
	ELSIF entry.hash IS DISTINCT FROM public.audit_fingerprint(entry) THEN
		RETURN 'Der Eintrag wurde nachträglich verändert.';
	END IF;

	IF entry.fingerprint_version = 2 OR is_redacted THEN
		IF (entry.old_value IS NOT NULL AND public.audit_value_digest(entry.old_value) IS DISTINCT FROM entry.old_value_digest)
		   OR (entry.new_value IS NOT NULL AND public.audit_value_digest(entry.new_value) IS DISTINCT FROM entry.new_value_digest) THEN
			RETURN 'Der Eintrag wurde nachträglich verändert.';
		END IF;

		IF (entry.old_value IS NULL AND entry.old_value_digest IS NOT NULL
		    AND NOT EXISTS (SELECT 1 FROM public.audit_redactions r WHERE r.entry_id = entry.id AND r.side = 'old'))
		   OR (entry.new_value IS NULL AND entry.new_value_digest IS NOT NULL
		    AND NOT EXISTS (SELECT 1 FROM public.audit_redactions r WHERE r.entry_id = entry.id AND r.side = 'new')) THEN
			RETURN 'Ein Wert des Eintrags fehlt, ohne dass er geschwärzt wurde.';
		END IF;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_value_commitment"(text, text);--> statement-breakpoint
DROP TABLE IF EXISTS "audit_value_nonces";
