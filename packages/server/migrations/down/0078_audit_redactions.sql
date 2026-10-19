-- Takes the redactions of the change log out again: the table, the triggers
-- and functions that came with it, and the three columns of `audit_entries`,
-- and puts back the functions of the log as they were. Run as the superuser,
-- like every rollback.
--
-- What it costs an installation that runs it: every entry written after this
-- version is hashed over the fingerprints of its values, and the check of the
-- chain from before this version finds the first of them changed. A value that
-- was blacked out stays gone. Take a backup before, and check the chain with
-- this version first.
DROP TABLE IF EXISTS "audit_redactions";--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_redaction_checked"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_redaction_applied"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_fingerprint"(entry public.audit_entries) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
	SET "TimeZone" = 'UTC'
AS $$
	SELECT encode(sha256(convert_to((to_jsonb(entry) - 'hash')::text, 'UTF8')), 'hex')
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
CREATE OR REPLACE FUNCTION "verify_audit_chain"(tenant uuid)
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
CREATE OR REPLACE FUNCTION "audit_entry_stays"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Das Audit-Log wird nur ergänzt. Ein Eintrag wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG002';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_entry_problem"(public.audit_entries);--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_witness"(public.audit_entries);--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_value_digest"(text);--> statement-breakpoint
ALTER TABLE "audit_entries" DROP COLUMN IF EXISTS "new_value_digest";--> statement-breakpoint
ALTER TABLE "audit_entries" DROP COLUMN IF EXISTS "old_value_digest";--> statement-breakpoint
ALTER TABLE "audit_entries" DROP COLUMN IF EXISTS "fingerprint_version";
