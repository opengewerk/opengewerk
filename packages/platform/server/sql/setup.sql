-- The four questions that have to be asked outside any tenant, and the one
-- way a first tenant comes to be. The policies they pass come from the schema;
-- the functions and who may call them are in here.
--
-- Each of them runs as the owner of the tables, for one statement, because the
-- caller cannot see what it asks about: outside a tenant the application reads
-- the tenants of its own memberships and nothing else, and at these moments
-- there is no membership, or nobody signed in at all. `FORCE ROW LEVEL
-- SECURITY` applies to the owner as well, which is why the tables they read
-- carry `readable_by_the_owner`, and why `tenants` carries `created_by_setup`
-- next to the restrictive policy that keeps the application from inserting.

-- Whether this instance has never been used.
--
-- Both halves are needed. No tenant and no account is the state a fresh
-- installation is in; either one on its own would leave the setup open next to
-- data that is already there.
--
-- STABLE, so it reads the snapshot of the statement that calls it rather than
-- one of its own. That is what makes it answer correctly inside
-- `create_first_tenant`, where the statement before it waited on a lock.
CREATE FUNCTION "instance_is_empty"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT NOT EXISTS (SELECT 1 FROM public.tenants)
	   AND NOT EXISTS (SELECT 1 FROM public.auth_users)
$$;--> statement-breakpoint

-- The one tenant a first run creates, and the only way the application ever
-- creates one unasked. The application role has no INSERT on `tenants`.
--
-- The lock is why this is a function and not a check in the application. Two
-- people opening the setup screen at the same moment would both be told the
-- instance is empty, and both would create a tenant. The advisory lock is held
-- until the transaction ends, whether it commits or rolls back, so the second
-- one asks after the first has committed and finds the tenant. Read committed
-- is what makes that work: the statement after the lock takes a fresh
-- snapshot. The key is arbitrary and only has to be unique in this database.
--
-- The id is minted here rather than read back with RETURNING. RETURNING reads
-- the new row back, so it asks the SELECT policies as well as the WITH CHECK,
-- and the refusal for either says the same sentence.
CREATE FUNCTION "create_first_tenant"(company text) RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	created uuid;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtext('opengewerk.first_run_setup'));

	IF NOT public.instance_is_empty() THEN
		RAISE EXCEPTION 'Diese Instanz ist bereits eingerichtet.'
			USING ERRCODE = 'OG003';
	END IF;

	created := uuidv7();

	INSERT INTO public.tenants (id, name) VALUES (created, company);

	RETURN created;
END;
$$;--> statement-breakpoint

-- The one invitation a token names, and the tenant it belongs to.
--
-- A redemption arrives without a session, so no tenant is set and the ordinary
-- policy on `invitations` matches no row: the caller cannot even find the
-- invitation that was made for them. The token is what names the tenant, and
-- the token can only be looked up by something that sees the table whole.
--
-- A set rather than a single row, so that an unknown token comes back as no
-- rows instead of a row of nulls a caller has to tell apart from a real one.
-- It returns the row as it stands, used, called back and expired ones
-- included, and the application decides what to say about each: sentences are
-- read by a person and belong where the rest of the wording is.
--
-- It cannot be turned into a way of listing invitations or tenants: the only
-- way in is a token whose hash matches, and the hash of 32 random bytes is not
-- something to guess at.
CREATE FUNCTION "invitation_for"(hash text)
	RETURNS TABLE (
		invitation_id uuid,
		business uuid,
		company text,
		invited_email text,
		invited_name text,
		invited_roles text[],
		expires timestamp with time zone,
		redeemed timestamp with time zone,
		revoked timestamp with time zone
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT i.id, i.tenant_id, t.name, i.email, i.name, i.roles,
	       i.expires_at, i.redeemed_at, i.revoked_at
	  FROM public.invitations i
	  JOIN public.tenants t ON t.id = i.tenant_id
	 WHERE i.token_hash = hash
$$;--> statement-breakpoint

-- The tenants of this instance, by identifier and nothing else.
--
-- The jobs that run in the background work for all of them and act for no
-- person, so they have no membership to find them through. Every read after
-- this one runs inside a tenant like any other, so the isolation of the data
-- is where it was.
CREATE FUNCTION "every_tenant"() RETURNS SETOF uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT id FROM public.tenants ORDER BY id
$$;--> statement-breakpoint

-- EXECUTE belongs to everybody by default, which for these four would mean
-- every role in the cluster. Taken away first and given back to the one role
-- that calls them, so that a role added later for something else does not
-- inherit a way past the isolation.
REVOKE EXECUTE ON FUNCTION "instance_is_empty"() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "create_first_tenant"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "invitation_for"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "every_tenant"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "instance_is_empty"() TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "create_first_tenant"(text) TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "invitation_for"(text) TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "every_tenant"() TO "opengewerk_app";
