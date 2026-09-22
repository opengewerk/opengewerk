#!/bin/sh
# Starts OpenGewerk: the first time, every time after, and after an update.
#
# First the .env, through setup.sh: on the first start every secret is made
# and the address asked for, later only what a newer version brought is
# added. No value is printed, only names.
#
# Then the migration on its own, and only after it the containers. That is the
# order the README explains under "Aktualisieren": `docker compose up -d`
# alone replaces the running application before the migration has even
# started, and a migration that fails leaves the instance standing still
# instead of answering on the state before.

set -eu

here=$(cd "$(dirname "$0")" && pwd)

say() {
  printf 'OpenGewerk: %s\n' "$*"
}

fail() {
  printf 'OpenGewerk: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 ||
  fail 'Docker fehlt auf dieser Maschine. OpenGewerk läuft in Docker: https://docs.docker.com/engine/install/'

docker compose version >/dev/null 2>&1 ||
  fail 'Docker Compose fehlt. Es gehört zu jeder aktuellen Docker-Installation und heißt "docker compose", ohne Bindestrich.'

sh "$here/setup.sh"

compose() {
  docker compose -f "$here/compose.yaml" "$@"
}

say 'Die Datenbank wird eingerichtet oder auf den neuen Stand gebracht.'
compose run --rm --build migrate ||
  fail 'Die Migration ist gescheitert, der Grund steht darüber. Eine laufende Instanz arbeitet unverändert weiter, die Datenbank steht auf dem Stand davor.'

say 'OpenGewerk startet.'
compose up -d --wait --wait-timeout 300 ||
  fail 'OpenGewerk ist nicht gestartet. Warum, zeigt: docker compose -f docker/compose.yaml logs app'

address=$(grep '^TRUSTED_ORIGINS=' "$here/.env" | head -n 1 | cut -d= -f2- | cut -d, -f1)
say "OpenGewerk läuft. Im Browser: $address"
