-- The role the application connects as, and its way into the schema.
--
-- Row level security never applies to a superuser, and it applies to the owner
-- of a table only where the table says FORCE. The application therefore
-- connects as a role of its own that is neither: no superuser rights and no
-- ownership of any table. What it may do with a table is granted table by
-- table, further down in the migration this block is part of.
--
-- The role gets no password and no LOGIN here. Whoever sets the instance up
-- gives it both; credentials do not belong in a file that sits in every clone
-- of a repository.
--
-- Created only when it is missing: a role belongs to the cluster and not to
-- the database, so a second database on the same server finds it there.

DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opengewerk_app') THEN
		CREATE ROLE "opengewerk_app" NOLOGIN;
	END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO "opengewerk_app";
