-- The audit log: one entry per field that changed, written by a trigger and
-- chained by hash. The two tables come from the schema; what is in here is
-- everything drizzle-kit does not know.
--
-- Four decisions are in here.
--
-- 1. A trigger, not a line in the server. A change has to show up in the log
--    whichever way it arrives, a migration and a psql session included.
--    Anything the application would have to write itself catches nothing at
--    exactly the point where the application is bypassed.
-- 2. The trigger goes on every table of a tenant. Which tables those are is
--    said table by table where the migration grants the rights, and a test
--    asks the catalogue afterwards: a new table without the trigger turns it
--    red.
-- 3. The application role gets SELECT on the two audit tables and nothing
--    else. It can neither forge an entry nor remove one; the only writer is
--    the trigger, running as its definer.
-- 4. Every entry carries the hash of the one before it. Append only stops a
--    change from being made through the database; the chain notices one that
--    was made anyway, by whatever means, and says where.
--
-- What none of this reaches: a superuser can turn the trigger off, and no
-- arrangement inside a database prevents that. What the chain does is make the
-- result visible afterwards, which is a different and more modest promise.

-- What an entry is hashed over: itself, minus its own hash. Taking the whole
-- row instead of a list of columns means the same call writes an entry and
-- checks it afterwards. One definition, not two that drift apart.
--
-- It also means the columns of `audit_entries` are frozen. One more column
-- changes the text form of every entry that is already there, and a chain
-- that was sound reports a break at entry one. A test holds the list.
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
	SELECT encode(sha256(convert_to((to_jsonb(entry) - 'hash')::text, 'UTF8')), 'hex')
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
-- has to produce the same chain.
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
-- It calls the same fingerprint the writer used, so the two cannot disagree
-- about what was hashed.
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

		IF entry.hash IS DISTINCT FROM public.audit_fingerprint(entry) THEN
			broken_at := entry.sequence;
			problem := 'Der Eintrag wurde nachträglich verändert.';
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

-- And the bolt in front of it. An entry is written once and not touched again.
-- TRUNCATE needs a trigger of its own, because it never touches the rows one
-- by one and a row trigger therefore never fires. Without it the whole log
-- would be one statement away.
--
-- The chain table has no such bolt and needs none: rewinding its counter makes
-- the next entry collide on a number already taken, and putting a different
-- head in breaks the chain at the following entry. Both are found by the
-- check, which is what the chain is for.
CREATE FUNCTION "audit_entry_stays"() RETURNS trigger AS $$
BEGIN
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
