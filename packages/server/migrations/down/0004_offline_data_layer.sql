-- The rollback for 0004_offline_data_layer.sql.

DO $$
DECLARE
	target text;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_trigger t
		  JOIN pg_class c ON c.oid = t.tgrelid
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND t.tgname = 'stamp_sync_columns'
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS "stamp_sync_columns" ON %I', target);
	END LOOP;
END
$$;--> statement-breakpoint

DROP FUNCTION IF EXISTS "stamp_sync_columns"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "next_sync_sequence"(uuid);--> statement-breakpoint

-- Both functions go back to the shape 0003 left them in. A rollback that keeps
-- the newer body would leave two columns out of the audit log that, after this
-- migration is gone, no longer exist as a reason.
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
		 WHERE k.field <> 'updated_at'
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

CREATE OR REPLACE FUNCTION "document_stays_fixed"() RETURNS trigger AS $$
BEGIN
	IF tg_op = 'DELETE' THEN
		IF old.status <> 'draft' THEN
			RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht gelöscht, sondern storniert.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN old;
	END IF;

	IF old.status = 'draft' THEN
		RETURN new;
	END IF;

	IF old.status = 'issued' AND new.status = 'cancelled' THEN
		IF to_jsonb(new) - 'status' - 'updated_at'
			IS DISTINCT FROM to_jsonb(old) - 'status' - 'updated_at' THEN
			RAISE EXCEPTION 'Beim Stornieren darf sich außer dem Status nichts ändern.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN new;
	END IF;

	RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht geändert, sondern storniert und neu ausgestellt.'
		USING ERRCODE = 'OG001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_isolation" ON "sync_conflicts";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "sync_operations";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "sync_sequences";--> statement-breakpoint
DROP POLICY IF EXISTS "written_by_trigger" ON "sync_sequences";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_conflicts";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_operations";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_sequences";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."conflict_reason";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."operation_outcome";--> statement-breakpoint

-- The columns go last, again asked of the catalogue.
DO $$
DECLARE
	target text;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_class c
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		  JOIN pg_attribute a ON a.attrelid = c.oid
		   AND a.attname = 'change_sequence' AND NOT a.attisdropped
		 WHERE n.nspname = 'public' AND c.relkind = 'r'
	LOOP
		EXECUTE format(
			'ALTER TABLE %I DROP COLUMN "version", DROP COLUMN "updated_by",
			 DROP COLUMN "device_id", DROP COLUMN "deleted_at", DROP COLUMN "change_sequence"',
			target
		);
	END LOOP;
END
$$;
