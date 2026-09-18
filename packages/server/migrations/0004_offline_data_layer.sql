-- The offline data layer. The part above comes from the schema; everything
-- from FORCE onwards is written by hand.
--
-- Three things arrive here that every row from now on carries, and all three
-- are kept by a trigger rather than by whoever writes the row. A line the
-- application has to remember is a line it forgets at the sixteenth place, and
-- here it would forget it invisibly: a stale version only hurts the next time
-- two devices meet, which is days later and somewhere else.
--
-- 1. `version`, `updated_by`, `device_id`: who changed the row, from where,
--    and how often it has changed at all.
-- 2. `change_sequence`: where the change sits in the tenant's stream. It comes
--    from one counter row per tenant, so the numbers come out in the order the
--    transactions commit. A cursor on timestamps instead would quietly skip a
--    row whose transaction started early and committed late, and the device
--    would never hear about that row again.
-- 3. `deleted_at`: a row is marked, not removed. A removed row is a row a
--    device that was offline never learns about, because a delta pull delivers
--    what changed and a row that is gone is not among it.
--
-- The two functions from 0003 are replaced here, both for the same reason:
-- they compare rows field by field, and four new columns that move on every
-- single write would otherwise show up as changes in the audit log and, worse,
-- make a cancellation look like an edit.

CREATE TYPE "public"."conflict_reason" AS ENUM('changed_elsewhere', 'record_is_fixed', 'online_only', 'record_missing', 'unknown_entity');--> statement-breakpoint
CREATE TYPE "public"."operation_outcome" AS ENUM('applied', 'conflict', 'skipped');--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"record_id" uuid NOT NULL,
	"reason" "conflict_reason" NOT NULL,
	"fields" text[] NOT NULL,
	"wanted" jsonb NOT NULL,
	"seen" jsonb NOT NULL,
	"found" jsonb NOT NULL,
	"device_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"record_id" uuid NOT NULL,
	"outcome" "operation_outcome" NOT NULL,
	"device_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_sequences" (
	"tenant_id" uuid NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_sequences_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "sync_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_sections" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_sections" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "board_sections" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "board_sections" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_sections" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inverters" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inverters" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "inverters" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "inverters" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inverters" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "change_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_sequences" ADD CONSTRAINT "sync_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_conflicts_open_idx" ON "sync_conflicts" USING btree ("tenant_id","resolved_at","recorded_at");--> statement-breakpoint
CREATE INDEX "sync_operations_record_idx" ON "sync_operations" USING btree ("tenant_id","entity","record_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_conflicts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("sync_conflicts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sync_conflicts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_operations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("sync_operations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sync_operations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "sync_sequences" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_sequences" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("sync_sequences"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (false);

ALTER TABLE "sync_sequences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_operations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_conflicts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "sync_sequences" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "sync_operations" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sync_conflicts" TO "opengewerk_app";--> statement-breakpoint

-- Replaced, not changed: four more columns stay out of the field log. All four
-- move on every single write and say nothing the entry does not already say
-- better. `updated_by` in particular would repeat the entry's own user on
-- every line.
--
-- `device_id` and `deleted_at` stay in. Nothing else records which device a
-- change came from, and marking a record as deleted is a change like any
-- other, in fact the one somebody is most likely to ask about later.
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

-- Same reason, other function. A cancellation now moves `version` and
-- `change_sequence` as well, and without leaving them out of the comparison
-- the one change that is still allowed on an issued document would be refused
-- as an edit.
--
-- `deleted_at` stays in the comparison on purpose: an issued document is not
-- deleted either, not even by marking it.
CREATE OR REPLACE FUNCTION "document_stays_fixed"() RETURNS trigger AS $$
DECLARE
	bookkeeping text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence'];
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
		IF to_jsonb(new) - bookkeeping IS DISTINCT FROM to_jsonb(old) - bookkeeping THEN
			RAISE EXCEPTION 'Beim Stornieren darf sich außer dem Status nichts ändern.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN new;
	END IF;

	RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht geändert, sondern storniert und neu ausgestellt.'
		USING ERRCODE = 'OG001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- The counter. SECURITY DEFINER because the application role has no business
-- writing here and does not have the grant for it; the number is handed out,
-- not asked for.
--
-- ON CONFLICT DO UPDATE rather than DO NOTHING, for the same reason as in the
-- audit chain: DO NOTHING would let a second transaction fall through without
-- seeing the row the first one has not committed yet.
CREATE FUNCTION "next_sync_sequence"(tenant uuid) RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	assigned bigint;
BEGIN
	INSERT INTO public.sync_sequences (tenant_id)
	VALUES (tenant)
	ON CONFLICT (tenant_id) DO UPDATE SET next_value = sync_sequences.next_value + 1,
		updated_at = now()
	RETURNING next_value INTO assigned;

	RETURN assigned;
END;
$$;--> statement-breakpoint

-- Rows that were already here get their place in the stream now, before the
-- trigger exists. Without this they would all sit at zero, and a device asking
-- for everything after zero would be told there is nothing. On a fresh
-- database this loop does nothing at all.
DO $$
DECLARE
	target text;
	row_id uuid;
	tenant uuid;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_class c
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		  JOIN pg_attribute a ON a.attrelid = c.oid
		   AND a.attname = 'change_sequence' AND NOT a.attisdropped
		 WHERE n.nspname = 'public' AND c.relkind = 'r'
		 ORDER BY c.relname
	LOOP
		FOR row_id, tenant IN
			EXECUTE format('SELECT id, tenant_id FROM %I ORDER BY created_at, id', target)
		LOOP
			EXECUTE format('UPDATE %I SET change_sequence = $1 WHERE id = $2', target)
				USING public.next_sync_sequence(tenant), row_id;
		END LOOP;
	END LOOP;
END
$$;--> statement-breakpoint

-- What keeps the five columns true. It does not touch a table, so it runs as
-- whoever triggered it; the counter it calls is the part that needs more.
CREATE FUNCTION "stamp_sync_columns"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.updated_at := now();
	new.updated_by := nullif(current_setting('app.user_id', true), '');
	new.device_id := nullif(current_setting('app.device_id', true), '');
	new.version := CASE WHEN tg_op = 'UPDATE' THEN old.version + 1 ELSE 1 END;
	new.change_sequence := public.next_sync_sequence(new.tenant_id);

	RETURN new;
END;
$$;--> statement-breakpoint

-- On every table that carries the sync columns, asked of the catalogue rather
-- than of a list.
--
-- The name matters. PostgreSQL fires BEFORE triggers in alphabetical order, so
-- `stamp_sync_columns` runs after `documents_stay_fixed` and the check on a
-- fixed document sees the row as the caller sent it. The function above leaves
-- these columns out of its comparison as well, so the order is not the only
-- thing holding it together.
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
		 ORDER BY c.relname
	LOOP
		EXECUTE format(
			'CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON %I
			 FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"()',
			target
		);
	END LOOP;
END
$$;
