-- The sweep of the file store (#657): the bytes of a file that no business
-- holds any more go out of the store once they are older than a day.
--
-- The store is one for the instance and a file lies in it once, whoever stored
-- it; which business still has a row for a file only the database knows, and
-- the run works for every business and acts for no person. It asks
-- `files_held`, which runs as the owner of the tables and answers for the
-- names the run found in the store, without saying which business holds one.
-- `files` is under FORCE, so it gets the policy `readable_by_the_owner` (from
-- the schema), as `memberships` and `invitations` have it. The function is the
-- block `setup.sql` of the foundation.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this one leaves the store as it is.
CREATE POLICY "readable_by_the_owner" ON "files" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE FUNCTION "files_held"(candidates text[]) RETURNS SETOF text
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT DISTINCT f.sha256 FROM public.files f WHERE f.sha256 = ANY (candidates)
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "files_held"(text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "files_held"(text[]) TO "opengewerk_app";
