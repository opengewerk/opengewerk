-- The audit log: one entry per field that changed, written by a trigger and
-- chained by hash. The tables come from the schema; what is in here is
-- everything drizzle-kit does not know.
--
-- Five decisions are in here.
--
-- 1. A trigger, not a line in the server. A change has to show up in the log
--    whichever way it arrives, a migration and a psql session included.
--    Anything the application would have to write itself catches nothing at
--    exactly the point where the application is bypassed.
-- 2. The trigger goes on every table of a tenant. Which tables those are is
--    said table by table where the migration grants the rights, and a test
--    asks the catalogue afterwards: a new table without the trigger turns it
--    red.
-- 3. The application role gets SELECT on the audit tables and nothing else,
--    and INSERT on the redactions under the policy below. It can neither
--    forge an entry nor remove one; the only writer is the trigger, running as
--    its definer.
-- 4. Every entry carries the hash of the one before it. Append only stops a
--    change from being made through the database; the chain notices one that
--    was made anyway, by whatever means, and says where.
-- 5. A value can be blacked out without breaking the chain (ADR 0013). An
--    entry written from version 2 on is hashed over a fingerprint of each of
--    its values instead of the values themselves; an entry of version 1 gets
--    the fingerprints of its values when one of them is first blacked out,
--    and its redaction keeps a witness of the whole entry. Only whoever leads
--    the tenant blacks out a value, with a reason, which the policy of the
--    redactions asks as the application, and the redaction itself stands in
--    the log.
--
-- What none of this reaches: a superuser can turn the trigger off, and no
-- arrangement inside a database prevents that. What the chain does is make the
-- result visible afterwards, which is a different and more modest promise.

-- The fingerprint of one value: SHA-256 of its text, nothing for nothing.
CREATE FUNCTION "audit_value_digest"(value text) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT CASE WHEN value IS NULL THEN NULL ELSE encode(sha256(convert_to(value, 'UTF8')), 'hex') END
$$;--> statement-breakpoint

-- What an entry is hashed over: itself, minus its own hash. Taking the whole
-- row instead of a list of columns means the same call writes an entry and
-- checks it afterwards. One definition, not two that drift apart.
--
-- Version 1 is every entry written before ADR 0013: hashed over its values,
-- without the three columns that came with version 2, so that its text is
-- exactly the text it was hashed over. Version 2 leaves the values out and
-- takes them in through their fingerprints, which stay when a value is
-- blacked out.
--
-- The columns of `audit_entries` are frozen beyond that. One more column
-- changes the text form of every entry, and a chain that was sound reports a
-- break at entry one. A test holds the list.
--
-- Both settings are pinned for a reason. pg_catalog first so nothing can be
-- slipped in front of a built in function; UTC because jsonb renders a
-- timestamp in the session time zone, so the very same entry would otherwise
-- hash differently in Berlin and in New York and a sound chain would look
-- broken abroad.
CREATE FUNCTION "audit_fingerprint"(entry public.audit_entries) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
	SET "TimeZone" = 'UTC'
AS $$
	SELECT encode(sha256(convert_to(CASE entry.fingerprint_version
		WHEN 1 THEN (to_jsonb(entry) - 'hash' - 'fingerprint_version' - 'old_value_digest' - 'new_value_digest')::text
		ELSE (to_jsonb(entry) - 'hash' - 'old_value' - 'new_value')::text
	END, 'UTF8')), 'hex')
$$;--> statement-breakpoint

-- The witness of an entry of version 1 once one of its values is blacked out:
-- the entry hashed like one of version 2, over the fingerprints of its values,
-- which the redaction set from the values it found intact.
CREATE FUNCTION "audit_witness"(entry public.audit_entries) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
	SET "TimeZone" = 'UTC'
AS $$
	SELECT encode(sha256(convert_to((to_jsonb(entry) - 'hash' - 'old_value' - 'new_value')::text, 'UTF8')), 'hex')
$$;--> statement-breakpoint

-- What is wrong with one entry by itself, or nothing: the check of the chain
-- asks it of every entry, and a redaction of the entry it is about to change.
-- A value present has to fit its fingerprint; a value missing beside a
-- fingerprint has to be one that was blacked out.
CREATE FUNCTION "audit_entry_problem"(entry public.audit_entries) RETURNS text
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

-- The writer. SECURITY DEFINER so that it reaches the log even when the role
-- that triggered it may not write there, which is precisely the case worth
-- having: otherwise the log would only be as complete as the rights of whoever
-- wants to get around it.
--
-- Every table carries its tenant in `tenant_id`. The one exception is
-- `tenants` itself, where the row's own id is the tenant. A table with neither
-- makes the insert fail on NOT NULL, and that is the right direction: loud
-- while migrating beats silent in the log.
--
-- The chain row is created on first use and locked either way. ON CONFLICT DO
-- UPDATE rather than DO NOTHING on purpose: DO NOTHING would let a second
-- transaction fall through without seeing the row the first one has not
-- committed yet, and the chain would fork.
--
-- One row per field that genuinely differs, compared over the text form from
-- to_jsonb rather than over a list of columns, and written one at a time in a
-- fixed order, because each hash covers the one before it and the same change
-- has to produce the same chain. Every entry is written in version 2.
--
-- Four columns stay out. All four move on every single write and say nothing
-- the entry does not already say better: `updated_at`, `updated_by`, `version`
-- and `change_sequence`. `device_id` and `deleted_at` stay in. Nothing else
-- records which device a change came from, and marking a record as deleted is
-- a change like any other, in fact the one somebody is most likely to ask
-- about later.
CREATE FUNCTION "record_change"() RETURNS trigger
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

-- Walks a tenant's chain and reports the first place that does not fit. Not
-- SECURITY DEFINER: run by the application it sees its own tenant and nothing
-- else, which is the right way round for a check a tenant runs on itself.
--
-- It asks each entry what the redaction asks before it changes one, so the
-- two cannot disagree about what fits.
CREATE FUNCTION "verify_audit_chain"(tenant uuid)
	RETURNS TABLE (checked bigint, broken_at bigint, problem text)
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	entry public.audit_entries;
	expected bigint := 1;
	previous text := NULL;
	found_problem text;
BEGIN
	checked := 0;
	broken_at := NULL;
	problem := NULL;

	FOR entry IN
		SELECT * FROM public.audit_entries e
		 WHERE e.tenant_id = tenant
		 ORDER BY e.sequence
	LOOP
		IF entry.sequence <> expected THEN
			broken_at := expected;
			problem := format('Eintrag %s fehlt, der nächste trägt die Nummer %s.',
				expected, entry.sequence);
			RETURN NEXT;
			RETURN;
		END IF;

		IF entry.previous_hash IS DISTINCT FROM previous THEN
			broken_at := entry.sequence;
			problem := 'Der Eintrag verweist nicht auf seinen Vorgänger.';
			RETURN NEXT;
			RETURN;
		END IF;

		found_problem := public.audit_entry_problem(entry);

		IF found_problem IS NOT NULL THEN
			broken_at := entry.sequence;
			problem := found_problem;
			RETURN NEXT;
			RETURN;
		END IF;

		checked := checked + 1;
		previous := entry.hash;
		expected := expected + 1;
	END LOOP;

	RETURN NEXT;
END;
$$;--> statement-breakpoint

-- Before a redaction is written: the row is of the tenant of the session and
-- the person of the session leads it, the entry is of this tenant, the value
-- is there, and the entry is still as it was written; then the fingerprints
-- of an entry of version 1 and its witness. Who redacts is the person of the
-- session, whatever the row said. SECURITY DEFINER to read the entry through
-- the policy that keeps the log to its writer.
--
-- The tenant and the lead come first, the way the policies of the table ask
-- them, because PostgreSQL asks those policies only after this trigger: an
-- entry of another tenant is nobody's business here, not even whether it is
-- there, and no row of it is locked.
CREATE FUNCTION "audit_redaction_checked"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	entry public.audit_entries;
	found_problem text;
BEGIN
	IF new.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid
	   OR NOT EXISTS (
	     SELECT 1 FROM public.memberships m
	       JOIN public.tenant_roles r ON r.tenant_id = m.tenant_id AND r.key = ANY (m.roles) AND r.leads
	      WHERE m.tenant_id = new.tenant_id
	        AND m.user_id = nullif(current_setting('app.user_id', true), '')
	        AND m.blocked_at IS NULL
	        AND (m.last_day IS NULL OR m.last_day >= (now() AT TIME ZONE 'Europe/Berlin')::date)) THEN
		RAISE EXCEPTION 'Einen Wert im Änderungsprotokoll schwärzt nur, wer den Mandanten führt.'
			USING ERRCODE = 'insufficient_privilege';
	END IF;

	SELECT * INTO entry FROM public.audit_entries e
	 WHERE e.id = new.entry_id AND e.tenant_id = new.tenant_id
	   FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Diesen Eintrag gibt es im Änderungsprotokoll nicht.'
			USING ERRCODE = 'OG006';
	END IF;

	IF (new.side = 'old' AND entry.old_value IS NULL) OR (new.side = 'new' AND entry.new_value IS NULL) THEN
		RAISE EXCEPTION 'Dieser Wert ist leer oder schon geschwärzt.'
			USING ERRCODE = 'OG006';
	END IF;

	found_problem := public.audit_entry_problem(entry);

	IF found_problem IS NOT NULL THEN
		RAISE EXCEPTION 'Der Eintrag ist nicht mehr, wie er geschrieben wurde; geschwärzt wird nichts. %', found_problem
			USING ERRCODE = 'OG006';
	END IF;

	new.redacted_by := nullif(current_setting('app.user_id', true), '');

	IF entry.fingerprint_version = 1 THEN
		IF entry.old_value_digest IS NULL AND entry.new_value_digest IS NULL THEN
			entry.old_value_digest := public.audit_value_digest(entry.old_value);
			entry.new_value_digest := public.audit_value_digest(entry.new_value);
		END IF;

		new.witness := public.audit_witness(entry);
	ELSE
		new.witness := NULL;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

-- After it is written: the value goes, and an entry of version 1 keeps the
-- fingerprints of its values. The bolt below lets exactly this change through
-- while `app.redacting` names the entry and the side. Both triggers of the
-- table are among its guards (`src/migration/guards.ts`).
CREATE FUNCTION "audit_redaction_applied"() RETURNS trigger
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

-- And the bolt in front of it. An entry is written once and not touched again,
-- with the one exception of a redaction under way: the value of the side it
-- names goes, and an entry of version 1 gets the fingerprints of its values,
-- and nothing else of the entry moves. TRUNCATE needs a trigger of its own,
-- because it never touches the rows one by one and a row trigger therefore
-- never fires. Without it the whole log would be one statement away.
--
-- The chain table has no such bolt and needs none: rewinding its counter makes
-- the next entry collide on a number already taken, and putting a different
-- head in breaks the chain at the following entry. Both are found by the
-- check, which is what the chain is for.
CREATE FUNCTION "audit_entry_stays"() RETURNS trigger AS $$
DECLARE
	named_side text;
BEGIN
	IF tg_op = 'UPDATE' AND current_setting('app.redacting', true) LIKE old.id::text || ':%' THEN
		named_side := split_part(current_setting('app.redacting', true), ':', 2);

		IF EXISTS (SELECT 1 FROM public.audit_redactions r WHERE r.entry_id = old.id AND r.side = named_side)
		   AND (to_jsonb(new) - 'old_value' - 'new_value' - 'old_value_digest' - 'new_value_digest')
		     = (to_jsonb(old) - 'old_value' - 'new_value' - 'old_value_digest' - 'new_value_digest')
		   AND (CASE WHEN named_side = 'old' THEN new.old_value IS NULL ELSE new.old_value IS NOT DISTINCT FROM old.old_value END)
		   AND (CASE WHEN named_side = 'new' THEN new.new_value IS NULL ELSE new.new_value IS NOT DISTINCT FROM old.new_value END)
		   AND new.old_value_digest IS NOT DISTINCT FROM coalesce(old.old_value_digest, public.audit_value_digest(old.old_value))
		   AND new.new_value_digest IS NOT DISTINCT FROM coalesce(old.new_value_digest, public.audit_value_digest(old.new_value)) THEN
			RETURN new;
		END IF;
	END IF;

	RAISE EXCEPTION 'Das Audit-Log wird nur ergänzt. Ein Eintrag wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG002';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "audit_entries_stay"
	BEFORE UPDATE OR DELETE ON "audit_entries"
	FOR EACH ROW EXECUTE FUNCTION "audit_entry_stays"();--> statement-breakpoint

CREATE TRIGGER "audit_entries_stay_on_truncate"
	BEFORE TRUNCATE ON "audit_entries"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_entry_stays"();
