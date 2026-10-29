-- The nonce of each value of the change log (B13 of the security audit of
-- 29.10.2026, amending ADR 0013).
--
-- Until now the fingerprint of a value was SHA-256 of its text, and it stays
-- when the value is blacked out. For a value that is easy to guess, a name, a
-- date, an amount, it gave the value back to whoever reads the database or a
-- backup. From here on every entry is written in version 3: each value gets a
-- nonce of 32 random bytes in `audit_value_nonces`, its fingerprint is taken
-- over the nonce and the value, and blacking out the value takes the nonce
-- with it. What stays says nothing about the value.
--
-- No entry is rewritten. Entries of version 1 and 2 are checked as before, and
-- what they keep of a value blacked out stays as guessable as it was; ADR 0013
-- says so.
--
-- The application reads the nonces, because the check of the chain runs as
-- the application; a nonce stands only beside a value the tenant reads in the
-- entry anyway. Only the trigger writes them, and nothing logs them.
--
-- **Fits the version before it**: it reads the log as before and writes
-- nothing into it itself. The entries its changes cause are written by the
-- trigger of this version.

CREATE TABLE "audit_value_nonces" (
	"entry_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"side" text NOT NULL,
	"nonce" text NOT NULL,
	CONSTRAINT "audit_value_nonces_pk" PRIMARY KEY("entry_id","side"),
	CONSTRAINT "audit_value_nonces_side_known" CHECK ("audit_value_nonces"."side" in ('old', 'new')),
	CONSTRAINT "audit_value_nonces_nonce_shaped" CHECK ("audit_value_nonces"."nonce" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit_value_nonces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_value_nonces" ADD CONSTRAINT "audit_value_nonces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "audit_value_nonces" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_value_nonces" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("audit_value_nonces"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (false);--> statement-breakpoint
ALTER TABLE "audit_value_nonces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Read by the check of the chain, written by the trigger alone.
GRANT SELECT ON "audit_value_nonces" TO "opengewerk_app";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_value_commitment"(nonce text, value text) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT CASE WHEN value IS NULL OR nonce IS NULL THEN NULL
		ELSE encode(sha256(decode(nonce, 'hex') || convert_to(value, 'UTF8')), 'hex') END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_entry_problem"(entry public.audit_entries) RETURNS text
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	kept_witness text;
	is_redacted boolean;
	old_nonce text;
	new_nonce text;
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

	IF entry.fingerprint_version >= 2 OR is_redacted THEN
		IF entry.fingerprint_version >= 3 THEN
			SELECT max(n.nonce) FILTER (WHERE n.side = 'old'), max(n.nonce) FILTER (WHERE n.side = 'new')
			  INTO old_nonce, new_nonce
			  FROM public.audit_value_nonces n
			 WHERE n.entry_id = entry.id;

			IF (entry.old_value IS NOT NULL AND public.audit_value_commitment(old_nonce, entry.old_value) IS DISTINCT FROM entry.old_value_digest)
			   OR (entry.new_value IS NOT NULL AND public.audit_value_commitment(new_nonce, entry.new_value) IS DISTINCT FROM entry.new_value_digest) THEN
				RETURN 'Der Eintrag wurde nachträglich verändert.';
			END IF;
		ELSIF (entry.old_value IS NOT NULL AND public.audit_value_digest(entry.old_value) IS DISTINCT FROM entry.old_value_digest)
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
	old_nonce text;
	new_nonce text;
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
	entry.fingerprint_version := 3;

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
		old_nonce := CASE WHEN entry.old_value IS NULL THEN NULL
			ELSE encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex') END;
		new_nonce := CASE WHEN entry.new_value IS NULL THEN NULL
			ELSE encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex') END;
		entry.old_value_digest := public.audit_value_commitment(old_nonce, entry.old_value);
		entry.new_value_digest := public.audit_value_commitment(new_nonce, entry.new_value);
		entry.hash := public.audit_fingerprint(entry);

		INSERT INTO public.audit_entries VALUES (entry.*);

		INSERT INTO public.audit_value_nonces (entry_id, tenant_id, side, nonce)
		SELECT entry.id, entry.tenant_id, s.side, s.nonce
		  FROM (VALUES ('old', old_nonce), ('new', new_nonce)) AS s(side, nonce)
		 WHERE s.nonce IS NOT NULL;

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

	DELETE FROM public.audit_value_nonces n
	 WHERE n.entry_id = new.entry_id AND n.side = new.side;

	PERFORM set_config('app.redacting', '', true);

	RETURN NULL;
END;
$$;
