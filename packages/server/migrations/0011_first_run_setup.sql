-- First run setup: how an empty instance gets its first business and its first
-- account without anybody opening psql.
--
-- The four policies come from the schema, everything below them is written by
-- hand, and the reason for each is the same one: creating a business is not
-- something the application may do.
--
-- **Why a function at all.** 0007 took INSERT on `tenants` away from
-- `opengewerk_app` and said so in as many words: creating a business belongs
-- to whoever sets up the instance. That is still true. What was missing is a
-- way for whoever sets up the instance to do it from a browser, and this is
-- that way: one function, which refuses unless there is nothing on the
-- instance at all.
--
-- **Why policies the owner can pass.** The function runs as the owner of the
-- tables, and `FORCE ROW LEVEL SECURITY` applies to the owner too. Every
-- policy written before today names `opengewerk_app`, so none of them matches
-- the owner, and with row level security on and nothing matching, there is
-- neither a row to read nor a row to write. `created_by_setup` is the open
-- policy that lets the insert through, the same shape the audit trigger needs
-- on its own tables, and the restrictive one next to it shuts the door around
-- the application a second time whatever else might permit.
-- `readable_by_the_owner` is the reading half, on the two tables the question
-- "has this instance ever been used" is asked of. Without it the answer would
-- always be yes, on every instance, because the owner sees no rows at all.
--
-- **Why a lock and not a check in the application.** Two people opening the
-- setup screen at the same moment would both be told the instance is empty,
-- and both would create a business. The lock is held until the transaction
-- ends, so the second one asks after the first has committed and finds the
-- business. Read committed is what makes that work: the statement after the
-- lock takes a fresh snapshot. `forInstanceAndTenant` in the application opens
-- its transaction at that level in so many words rather than trusting the
-- server's default.

CREATE POLICY "readable_by_the_owner" ON "auth_users" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "created_by_setup" ON "tenants" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "no_application_insert" ON "tenants" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "tenants" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint

-- Whether this instance has never been used.
--
-- Both halves are needed. No business and no account is the state a fresh
-- installation is in; either one on its own would leave the setup open next to
-- data that is already there.
--
-- SECURITY DEFINER because the application cannot answer this question itself:
-- outside any business it sees the companies of its own memberships, and
-- during a first run there is no membership and nobody signed in, so it would
-- find an empty table on an instance full of companies. As the owner it sees
-- both tables whole, which is what `readable_by_the_owner` above is for.
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

-- The one business a first run creates, and the only way the application ever
-- creates one.
--
-- The advisory lock is released when the transaction ends, whether it commits
-- or rolls back, so a setup that fails halfway leaves nothing behind. The key
-- is arbitrary and only has to be unique in this database; it is the only
-- advisory lock the schema uses.
--
-- The id is minted here rather than read back with RETURNING. Both work now
-- that the owner may read the table, and minting it needs one policy fewer to
-- be true: RETURNING reads the new row back, so it asks the SELECT policies as
-- well as the WITH CHECK, and the refusal for either says the same sentence.
-- PostgreSQL 18 mints these itself for the column default, and this is the
-- same call.
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

-- EXECUTE is granted to everybody by default, which for these two would mean
-- every role in the cluster. Taken away first and given back to the one role
-- that calls them, so that a role added later for something else does not
-- inherit the ability to create a business.
REVOKE EXECUTE ON FUNCTION "instance_is_empty"() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "create_first_tenant"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "instance_is_empty"() TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "create_first_tenant"(text) TO "opengewerk_app";
