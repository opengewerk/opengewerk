-- What belongs to the instance and to no business (#188), and further
-- businesses on it (#142): the operators, the settings of the instance, the
-- log of both, and the two functions that create a business and list them.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand.
--
-- **Why a log of its own.** The log of a business needs a business: its
-- trigger takes the tenant from the row and writes it into a column that
-- cannot be null. These tables have none, so they get `record_instance_change`,
-- the same trigger without a tenant and without the chain, writing into
-- `instance_changes`. It also watches `tenants` for a business being created
-- or removed, which is something that happens to the instance; a new name is
-- the business's own affair and stays in its log.
--
-- **Why the first operator comes from the log of a business.** The operator is
-- the account of the first run setup. On an instance set up before this
-- migration that account is nowhere marked, but the first run wrote the
-- membership of its owner into the log of the first business with the reason
-- `instance.setup`, and that entry names it. Reading it needs `FORCE` off for a
-- moment: a migration runs as the owner, no policy names the owner, and under
-- `FORCE` it would find no entry and appoint nobody, reporting success (ADR
-- 0003). Where there is no such entry, `appoint-operator` names one on the
-- command line.
--
-- **Why creating a business is a function.** 0007 took INSERT on `tenants`
-- away from the application, and 0011 gave it back for exactly one case, the
-- first run on an empty instance. `create_tenant` is the second case, without
-- the question whether the instance is empty; who may call it, an owner for
-- himself and an operator for somebody else, the server decides. The
-- membership of the new owner is written after it, inside the new business, in
-- the same transaction, so that it lands in that business's log.

CREATE TABLE "instance_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"change_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"operation" "audit_operation" NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"reason" text,
	"database_role" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "instance_operators" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_operators_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "instance_operators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"mail_internal_hosts" text[] DEFAULT '{}'::text[] NOT NULL,
	"backup_time" time DEFAULT '02:30' NOT NULL,
	"imported_from_environment_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_one_row" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instance_operators" ADD CONSTRAINT "instance_operators_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instance_changes_time_idx" ON "instance_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "instance_changes" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "instance_changes" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "instance_operators" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "instance_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint

ALTER TABLE "instance_operators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instance_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instance_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "instance_operators" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, UPDATE ON "instance_settings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT ON "instance_changes" TO "opengewerk_app";--> statement-breakpoint

-- The log of the instance is only ever added to, like the log of a business,
-- and TRUNCATE needs a trigger of its own because it never touches a row.
CREATE FUNCTION "instance_change_stays"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Das Protokoll der Instanz wird nur ergänzt. Ein Eintrag wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG002';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "instance_changes_stay"
	BEFORE UPDATE OR DELETE ON "instance_changes"
	FOR EACH ROW EXECUTE FUNCTION "instance_change_stays"();--> statement-breakpoint

CREATE TRIGGER "instance_changes_stay_on_truncate"
	BEFORE TRUNCATE ON "instance_changes"
	FOR EACH STATEMENT EXECUTE FUNCTION "instance_change_stays"();--> statement-breakpoint

-- The writer of the log of the instance: one row per field that differs, the
-- fields of one write sharing a change id, as `record_change` writes the log
-- of a business. SECURITY DEFINER so that it reaches the log whoever made the
-- change, and the same four columns stay out of the comparison.
CREATE FUNCTION "record_instance_change"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	before_row jsonb := '{}'::jsonb;
	after_row jsonb := '{}'::jsonb;
	present jsonb;
	change uuid := uuidv7();
	changed text;
BEGIN
	IF tg_op <> 'INSERT' THEN
		before_row := to_jsonb(old);
	END IF;

	IF tg_op <> 'DELETE' THEN
		after_row := to_jsonb(new);
	END IF;

	present := CASE WHEN tg_op = 'DELETE' THEN before_row ELSE after_row END;

	FOR changed IN
		SELECT k.field
		  FROM jsonb_object_keys(before_row || after_row) AS k(field)
		 WHERE NOT (k.field = ANY (ARRAY['updated_at', 'updated_by', 'version', 'change_sequence']))
		   AND (before_row ->> k.field) IS DISTINCT FROM (after_row ->> k.field)
		 ORDER BY k.field
	LOOP
		INSERT INTO public.instance_changes (change_id, table_name, record_id, operation, field,
			old_value, new_value, user_id, reason, database_role)
		VALUES (change, tg_table_name, present ->> 'id', lower(tg_op)::public.audit_operation, changed,
			before_row ->> changed, after_row ->> changed,
			nullif(current_setting('app.user_id', true), ''),
			nullif(current_setting('app.reason', true), ''),
			session_user);
	END LOOP;

	RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "instance_changes" AFTER INSERT OR UPDATE OR DELETE ON "instance_operators"
	FOR EACH ROW EXECUTE FUNCTION "record_instance_change"();--> statement-breakpoint
CREATE TRIGGER "instance_changes" AFTER INSERT OR UPDATE OR DELETE ON "instance_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_instance_change"();--> statement-breakpoint
CREATE TRIGGER "instance_changes" AFTER INSERT OR DELETE ON "tenants"
	FOR EACH ROW EXECUTE FUNCTION "record_instance_change"();--> statement-breakpoint

-- The one row of settings, with the defaults: no mail server in the own
-- network, the backup at 02:30 as before. The server takes MAIL_INTERNAL_HOSTS
-- over from the .env at its first start and marks it done.
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
ALTER TABLE "instance_settings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "instance_settings" ("id") VALUES (1);--> statement-breakpoint
ALTER TABLE "instance_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The first operator: the account whose membership the first run wrote.
ALTER TABLE "audit_entries" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instance_operators" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "instance_operators" ("user_id")
SELECT first.user_id
  FROM (SELECT e.new_value AS user_id
          FROM "audit_entries" e
         WHERE e.table_name = 'memberships'
           AND e.field = 'user_id'
           AND e.reason = 'instance.setup'
         ORDER BY e.changed_at, e.sequence
         LIMIT 1) first
  JOIN "auth_users" u ON u.id = first.user_id;--> statement-breakpoint
ALTER TABLE "instance_operators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint

-- Reading the memberships of every business, for the list of businesses an
-- operator sees. The owner of the tables reads them only through the function
-- below, which hands out names, days and counts and no row of a business.
CREATE POLICY "readable_by_the_owner" ON "memberships" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint

-- A further business. The name is checked here as well as in the server, so
-- that no other way in creates a business without one.
CREATE FUNCTION "create_tenant"(company text) RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	created uuid;
BEGIN
	IF company IS NULL OR length(btrim(company)) = 0 OR length(btrim(company)) > 120 THEN
		RAISE EXCEPTION 'Ein Betrieb braucht einen Namen mit höchstens 120 Zeichen.'
			USING ERRCODE = 'OG003';
	END IF;

	created := uuidv7();

	INSERT INTO public.tenants (id, name) VALUES (created, btrim(company));

	RETURN created;
END;
$$;--> statement-breakpoint

-- The businesses of the instance as an operator sees them: the name, the day
-- it was created, its owners and how many people work in it, and the owners
-- still invited. Nothing of what is in a business.
CREATE FUNCTION "instance_tenants"()
	RETURNS TABLE (id uuid, name text, created_at timestamptz, owners text[], members bigint, invited_owners text[])
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT t.id, t.name, t.created_at,
	       coalesce((SELECT array_agg(m.user_id ORDER BY m.created_at) FROM public.memberships m
	                  WHERE m.tenant_id = t.id AND 'owner' = ANY (m.roles) AND m.blocked_at IS NULL), '{}'),
	       (SELECT count(*) FROM public.memberships m WHERE m.tenant_id = t.id),
	       coalesce((SELECT array_agg(i.email ORDER BY i.created_at) FROM public.invitations i
	                  WHERE i.tenant_id = t.id AND 'owner' = ANY (i.roles)
	                    AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()), '{}')
	  FROM public.tenants t
	 ORDER BY t.created_at, t.name
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "create_tenant"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "instance_tenants"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "create_tenant"(text) TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "instance_tenants"() TO "opengewerk_app";
