#!/bin/sh
# Creates the two roles of postgres-init/10-roles.sh with passwords that hold
# what SQL and psql read as more than text, a quote, a backslash, a colon and
# a semicolon, and signs in with each (#688). The script has to take any
# password an operator writes into the .env, not only the ones setup.sh
# makes. In the image of the database in compose.yaml, as the user and with
# the read-only root file system the service has there.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
container="opengewerk-test-roles-$$"

image=$(sed -n '/^  postgres:$/{n;s/^ *image: //p;}' "$here/compose.yaml")
[ -n "$image" ] || {
  echo "In $here/compose.yaml steht kein Abbild für die Datenbank." >&2
  exit 1
}

# A quote, which ends a literal, a backslash, which escapes in some of them,
# and a colon, which psql reads as the start of a variable.
owner_password="it's \\'quoted\\' :owner_password; drop role postgres; --"
app_password="'; select 1; '':app_password"

trap 'docker rm --force "$container" > /dev/null 2>&1 || true' EXIT

docker run --detach --name "$container" \
  --user postgres --read-only --tmpfs /var/run/postgresql \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --env POSTGRES_PASSWORD=probe --env POSTGRES_DB=opengewerk \
  --env OPENGEWERK_OWNER_PASSWORD="$owner_password" \
  --env OPENGEWERK_APP_PASSWORD="$app_password" \
  --volume "$here/postgres-init:/docker-entrypoint-initdb.d:ro" \
  "$image" > /dev/null

# The entrypoint runs the scripts against a server on the socket alone and
# starts the real one after them, the one that listens on TCP.
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready --host 127.0.0.1 --quiet; then
    break
  fi

  if [ "$(docker inspect --format '{{.State.Running}}' "$container")" != true ]; then
    docker logs "$container" >&2
    echo 'Die Datenbank ist beim Anlegen der Rollen beendet worden.' >&2
    exit 1
  fi

  sleep 1
done

docker logs "$container" 2>&1 | grep -q 'Rollen opengewerk_owner und opengewerk_app angelegt.' || {
  docker logs "$container" >&2
  echo '10-roles.sh hat die Rollen nicht angelegt.' >&2
  exit 1
}

for role in opengewerk_owner opengewerk_app; do
  if [ "$role" = opengewerk_owner ]; then
    password=$owner_password
  else
    password=$app_password
  fi

  signed_in=$(docker exec --env PGPASSWORD="$password" "$container" \
    psql --host 127.0.0.1 --username "$role" --dbname opengewerk --tuples-only --no-align \
    --command 'select current_user') || {
    echo "Mit dem Passwort aus der .env meldet sich $role nicht an." >&2
    exit 1
  }

  [ "$signed_in" = "$role" ] || {
    echo "Angemeldet als ${signed_in}, erwartet ${role}." >&2
    exit 1
  }

  echo "check: $role meldet sich mit einem Passwort mit Anführungszeichen an"
done

# Nothing of a password ran as a statement: the superuser is still there.
roles=$(docker exec "$container" psql --username postgres --dbname opengewerk --tuples-only --no-align \
  --command "select count(*) from pg_roles where rolname in ('postgres', 'opengewerk_owner', 'opengewerk_app')")
[ "$roles" = 3 ] || {
  echo "Statt drei Rollen gibt es ${roles}." >&2
  exit 1
}

echo 'check: kein Teil eines Passworts lief als Anweisung'
