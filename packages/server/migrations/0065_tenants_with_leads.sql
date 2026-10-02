-- Who leads a business is read from its roles and no longer from the name
-- "owner", for the list of businesses an operator sees (ADR 0010).
--
-- Since 0063 the roles of a business are rows, and a row says whether its role
-- leads. `instance_tenants()` from 0051 still asked for a membership that
-- names "owner". That is right for the three roles a business starts with and
-- wrong the day one calls the role that leads it something else, or takes the
-- leading away from the one that shipped; and it is the word of this
-- application, where the area of the instance now belongs to the foundation
-- and is the same for every application built on it.
--
-- So the function is replaced by `tenants_with_leads()`, which asks the rows:
-- a membership or an invitation counts when one of the roles it names is a
-- role of that business that leads. Its columns are called what they hold,
-- `leads` and `invited_leads`. It runs as the owner of the tables, and under
-- `FORCE` the owner sees no row of `tenant_roles` without a policy that names
-- him, so the table gets `readable_by_the_owner`, like `tenants`, the accounts,
-- the memberships and the invitations before it. The function hands out names
-- and counts and no row of that table.
--
-- `instance_tenants()` is dropped in the same step and not a release later.
-- No released version calls it: it came with 0051, after 0.4.0, and an update
-- from a release therefore never has an older application asking for it while
-- this runs.
--
-- `create_tenant` keeps what it does and loses a word. Its refusal of a name
-- that is none said "Betrieb", which is what this application calls a tenant;
-- the function is the foundation's now, and the sentence calls a tenant
-- nothing. Nobody reads it in the ordinary course: the server asks the rule of
-- the application first and refuses in its words.
--
-- Nothing is written and no row is touched.

CREATE POLICY "readable_by_the_owner" ON "tenant_roles" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint

DROP FUNCTION "instance_tenants"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "create_tenant"(company text) RETURNS uuid
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

REVOKE EXECUTE ON FUNCTION "tenants_with_leads"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "tenants_with_leads"() TO "opengewerk_app";
