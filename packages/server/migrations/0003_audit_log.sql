-- Field level audit log. The part above comes from the schema; everything from
-- FORCE onwards is written by hand, because drizzle-kit knows none of it: the
-- grants, the trigger that writes the log, and the trigger that pins down what
-- was written.
--
-- Four decisions are in here.
--
-- 1. A trigger, not a line in the server. A change has to show up in the log
--    whichever way it arrives, a migration and a psql session included.
--    Anything the application would have to write itself catches nothing at
--    exactly the point where the application is bypassed.
-- 2. The trigger goes on every table, attached by walking the catalogue rather
--    than a list. A list would already be incomplete the day it is written.
--    That does not help the next migration, so a test asks the catalogue the
--    same question afterwards: a new table without the trigger turns it red.
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

CREATE TYPE "public"."audit_operation" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TABLE "audit_chains" (
	"tenant_id" uuid NOT NULL,
	"next_sequence" bigint DEFAULT 1 NOT NULL,
	"head_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_chains_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "audit_chains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"operation" "audit_operation" NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence" bigint NOT NULL,
	"previous_hash" text,
	"hash" text NOT NULL,
	"user_id" text,
	"reason" text,
	"database_role" text NOT NULL,
	CONSTRAINT "audit_entries_sequence" UNIQUE("tenant_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_chains" ADD CONSTRAINT "audit_chains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_record_idx" ON "audit_entries" USING btree ("tenant_id","table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_entries_time_idx" ON "audit_entries" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "audit_chains" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_chains" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("audit_chains"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "audit_entries" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_entries" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("audit_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (false);

ALTER TABLE "audit_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_chains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "audit_entries" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT ON "audit_chains" TO "opengewerk_app";--> statement-breakpoint

-- What an entry is hashed over: itself, minus its own hash. Taking the whole
-- row instead of a list of columns means a column added later is covered
-- without anybody remembering to add it here, and the same call is used to
-- write an entry and to check it afterwards. One definition, not two that
-- drift apart.
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
-- One row per field that genuinely differs. The comparison runs over the text
-- form from to_jsonb rather than over a list of columns. The single exception
-- is updated_at, whose entire message, "something changed here", the log
-- already states more precisely.
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

	-- Every table carries its tenant in tenant_id. The one exception is tenants
	-- itself, where the row's own id is the tenant. A future table with neither
	-- makes the insert below fail on NOT NULL, and that is the right direction:
	-- loud while migrating beats silent in the log.
	entry.tenant_id := coalesce(present ->> 'tenant_id', present ->> 'id')::uuid;
	entry.record_id := (present ->> 'id')::uuid;
	entry.change_id := uuidv7();
	entry.table_name := tg_table_name;
	entry.operation := lower(tg_op)::public.audit_operation;
	entry.changed_at := now();
	entry.user_id := nullif(current_setting('app.user_id', true), '');
	entry.reason := nullif(current_setting('app.reason', true), '');
	entry.database_role := session_user;

	-- Creates the tenant's chain on first use and locks it either way. ON
	-- CONFLICT DO UPDATE rather than DO NOTHING on purpose: DO NOTHING would let
	-- a second transaction fall through without seeing the row the first one has
	-- not committed yet, and the chain would fork.
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
		-- One at a time, because each hash covers the one before it. The order is
		-- fixed so that the same change always produces the same chain.
		entry.id := uuidv7();
		entry.sequence := place;
		entry.previous_hash := previous;
		entry.field := changed;
		entry.old_value := before_row ->> changed;
		entry.new_value := after_row ->> changed;
		-- The fingerprint leaves the hash column out, so whatever the previous
		-- round left in it cannot reach the result.
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
-- else, which is the right way round for a check a company runs on itself.
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

-- On every table except the two the log itself is made of. Those would log
-- their own logging, and each entry would produce the next one forever. The
-- migration tool's table stays out as well: it has no id column and belongs to
-- no tenant.
DO $$
DECLARE
	target text;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_class c
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public'
		   AND c.relkind = 'r'
		   AND c.relname NOT IN ('audit_entries', 'audit_chains', '__drizzle_migrations')
		 ORDER BY c.relname
	LOOP
		EXECUTE format(
			'CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON %I
			 FOR EACH ROW EXECUTE FUNCTION "record_change"()',
			target
		);
	END LOOP;
END
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
