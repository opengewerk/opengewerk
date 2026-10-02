-- The area of the instance: what belongs to the instance and to no tenant.
-- The log of who runs it and what holds for every tenant on it, the one way a
-- further tenant comes to be, and the tenants as whoever runs the instance
-- sees them. The tables and their policies come from the schema; the
-- functions, the triggers, the one row of settings and who may call what are
-- in here.
--
-- **Why a log of its own.** The log of a tenant needs a tenant: its trigger
-- takes the tenant from the row and writes it into a column that cannot be
-- null. These tables have none, so they get `record_instance_change`, the same
-- trigger without a tenant and without the chain, writing into
-- `instance_changes`. It also watches `tenants` for a tenant being created or
-- removed, which is something that happens to the instance; a new name is the
-- tenant's own affair and stays in its log.

-- The log of the instance is only ever added to, like the log of a tenant,
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
-- of a tenant. SECURITY DEFINER so that it reaches the log whoever made the
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
-- network, the backup at half past two. Written here because nothing else may:
-- the application role updates the row and never inserts one.
--
-- `FORCE` is off for the moment of the insert. This runs as the owner, no
-- policy names the owner, and under `FORCE` the insert would be refused. The
-- trigger above is already in place, so the row stands in the log of the
-- instance as written by a migration.
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
ALTER TABLE "instance_settings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "instance_settings" ("id") VALUES (1);--> statement-breakpoint
ALTER TABLE "instance_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint

-- A further tenant, and besides the first run the only way the application
-- creates one: it has no INSERT on `tenants`. Who may call this, somebody who
-- leads a tenant for themselves and whoever runs the instance for somebody
-- else, the server decides. What makes somebody lead the new tenant is
-- written after it, inside the new tenant, in the same transaction, so that it
-- lands in that tenant's log.
--
-- The name is checked here as well as in the server, so that no other way in
-- creates a tenant without one. What a name has to be beyond that is the rule
-- of the application, asked before this is called and in its words; the
-- sentence here is the last line behind it and calls a tenant nothing.
CREATE FUNCTION "create_tenant"(company text) RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	created uuid;
BEGIN
	IF company IS NULL OR length(btrim(company)) = 0 OR length(btrim(company)) > 120 THEN
		RAISE EXCEPTION 'Der Name fehlt oder ist länger als 120 Zeichen.'
			USING ERRCODE = 'OG003';
	END IF;

	created := uuidv7();

	INSERT INTO public.tenants (id, name) VALUES (created, btrim(company));

	RETURN created;
END;
$$;--> statement-breakpoint

-- The tenants of the instance as whoever runs it sees them: the name, the day
-- it was created, who leads it and can still get in, how many people work in
-- it, and who is invited to lead it. Nothing of what is in a tenant.
--
-- Who leads is read from the roles of the tenant and not from the name of a
-- role: a membership or an invitation counts when one of the roles it names is
-- a role of that tenant that leads. It runs as the owner of the tables, which
-- is why `tenant_roles` carries `readable_by_the_owner` like the tables beside
-- it.
CREATE FUNCTION "tenants_with_leads"()
	RETURNS TABLE (id uuid, name text, created_at timestamptz, leads text[], members bigint, invited_leads text[])
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT t.id, t.name, t.created_at,
	       coalesce((SELECT array_agg(m.user_id ORDER BY m.created_at) FROM public.memberships m
	                  WHERE m.tenant_id = t.id AND m.blocked_at IS NULL
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (m.roles))), '{}'),
	       (SELECT count(*) FROM public.memberships m WHERE m.tenant_id = t.id),
	       coalesce((SELECT array_agg(i.email ORDER BY i.created_at) FROM public.invitations i
	                  WHERE i.tenant_id = t.id
	                    AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (i.roles))), '{}')
	  FROM public.tenants t
	 ORDER BY t.created_at, t.name
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "create_tenant"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "tenants_with_leads"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "create_tenant"(text) TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "tenants_with_leads"() TO "opengewerk_app";
