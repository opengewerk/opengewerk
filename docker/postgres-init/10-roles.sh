#!/bin/sh
# Creates the two roles OpenGewerk works with. Runs once, on the first start
# of the database container, as the superuser and before any migration.
#
# Why here and not in a migration: credentials do not belong in a file that
# sits in every clone of the repository. The migration creates opengewerk_app
# without a password and without LOGIN, and whoever sets up the instance fills
# both in. This script is "whoever sets up the instance" for the Compose case.
#
# The split between the two roles is the point:
#
#   opengewerk_owner  owns the tables and migrates. Row level security applies
#                     to it only through FORCE, which is why the application
#                     never connects as this role.
#   opengewerk_app    is what the application connects as. No ownership, no
#                     rights on the schema, only what the migrations grant it.

set -eu

if [ -z "${OPENGEWERK_OWNER_PASSWORD:-}" ] || [ -z "${OPENGEWERK_APP_PASSWORD:-}" ]; then
	echo "OPENGEWERK_OWNER_PASSWORD und OPENGEWERK_APP_PASSWORD müssen gesetzt sein." >&2
	echo "Sie stehen in der .env-Datei neben der Compose-Datei." >&2
	exit 1
fi

# The passwords go in as psql variables rather than as text in the statement.
# One with a quote in it would otherwise either break the script or create
# something other than what was meant.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
	--set ON_ERROR_STOP=1 \
	--set owner_password="$OPENGEWERK_OWNER_PASSWORD" \
	--set app_password="$OPENGEWERK_APP_PASSWORD" \
	--set db_name="$POSTGRES_DB" <<'SQL'
\set quoted_owner_password '''' :owner_password ''''
\set quoted_app_password '''' :app_password ''''

CREATE ROLE opengewerk_owner LOGIN PASSWORD :quoted_owner_password CREATEROLE;
CREATE ROLE opengewerk_app LOGIN PASSWORD :quoted_app_password;

-- The owner creates the tables, so the schema belongs to it. Since PostgreSQL
-- 15 nobody but the owner may create in public anyway, which is exactly right
-- here.
ALTER SCHEMA public OWNER TO opengewerk_owner;

-- And it has to be able to create a schema, not only tables: the migration
-- tool keeps its own bookkeeping in a schema called "drizzle" and creates it
-- on the first run.
GRANT CREATE ON DATABASE :"db_name" TO opengewerk_owner;

-- The application role gets nothing further here. Every single grant sits in
-- the migration that creates the table it belongs to, which is the place it
-- can be noticed while reading.
SQL

echo "Rollen opengewerk_owner und opengewerk_app angelegt."
