-- Takes back 0065. Played in as the superuser, like every rollback: the list
-- of businesses asks for the name "owner" again, `create_tenant` says
-- "Betrieb" again, and the owner of the tables no longer reads the roles.

DROP FUNCTION IF EXISTS "tenants_with_leads"();

CREATE OR REPLACE FUNCTION "create_tenant"(company text) RETURNS uuid
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
$$;

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
$$;

REVOKE EXECUTE ON FUNCTION "instance_tenants"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "instance_tenants"() TO "opengewerk_app";

DROP POLICY IF EXISTS "readable_by_the_owner" ON "tenant_roles";
