#!/bin/sh
# Exercises the choice start.sh makes (#155), with a docker that only writes
# down what it was asked: a checkout of the source builds, a release kit pulls
# the version in its compose.yaml and builds nothing, and a version in the .env
# or the environment wins. What the containers then do is the job of the CI
# run that starts the whole stack.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

source_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin" "$work/docker"
cp "$source_dir/start.sh" "$source_dir/setup.sh" "$source_dir/.env.example" \
  "$source_dir/compose.yaml" "$work/docker/"

# Every call as one line: the version it saw in the environment, then the
# arguments. "docker compose version" answers like the real one does.
cat > "$work/bin/docker" <<'FAKE'
#!/bin/sh
printf '%s|%s\n' "${OPENGEWERK_VERSION:-}" "$*" >> "$CALLS"
FAKE
chmod +x "$work/bin/docker"

CALLS="$work/calls"
PATH="$work/bin:$PATH"
export CALLS PATH

check() {
  printf 'check: %s\n' "$1"
}

# An if and not "! grep": set -e leaves out a negated command, so a check
# written that way could never fail.
absent() {
  if grep -q -- "$1" "$CALLS"; then
    printf 'FEHLER: aufgerufen wurde%s\n' "$1"
    exit 1
  fi
}

start() {
  : > "$CALLS"
  OPENGEWERK_ADDRESS=http://127.0.0.1:23700 sh "$work/docker/start.sh" < /dev/null > /dev/null 2>&1
}

pin() {
  sed "s/^OPENGEWERK_VERSION=.*/OPENGEWERK_VERSION=$1/" "$work/docker/.env" > "$work/docker/.env.new"
  mv "$work/docker/.env.new" "$work/docker/.env"
}

pulled() {
  grep -q "^$1|compose -f .*compose.yaml pull --policy missing\$" "$CALLS"
  grep -q "^$1|compose -f .*compose.yaml run --rm migrate\$" "$CALLS"
  grep -q "^$1|compose -f .*compose.yaml up -d --wait" "$CALLS"
  absent ' build'
}

# 1. A checkout: "source" in compose.yaml, nothing in the .env. The backup is
# built along with the application.
start
grep -q '|compose -f .*compose.yaml build migrate backup-schedule$' "$CALLS"
grep -q '|compose -f .*compose.yaml run --rm migrate$' "$CALLS"
absent ' pull'
check 'Quelltext: Anwendung und Sicherung gebaut, nichts geholt'

# 2. A release kit: the version in compose.yaml, written there the way the
# release workflow writes it.
sed 's/OPENGEWERK_VERSION:-source}/OPENGEWERK_VERSION:-0.3.0}/' "$work/docker/compose.yaml" > "$work/docker/compose.kit"
mv "$work/docker/compose.kit" "$work/docker/compose.yaml"
start
pulled '0\.3\.0'
check 'Paket: Fassung 0.3.0 geholt, nichts gebaut'

# 3. A version in the .env wins over the kit, also written by hand on Windows.
pin 0.2.1
start
pulled '0\.2\.1'
check 'Fassung aus der .env geht vor'

printf 'OPENGEWERK_VERSION="0.2.2" # pinned\r\n' > "$work/docker/.env.line"
grep -v '^OPENGEWERK_VERSION=' "$work/docker/.env" >> "$work/docker/.env.line"
mv "$work/docker/.env.line" "$work/docker/.env"
start
pulled '0\.2\.2'
check 'Anführungszeichen, Kommentar und Zeilenende aus Windows gehören nicht zur Fassung'

# 4. And the environment over the .env, as Docker Compose has it.
: > "$CALLS"
OPENGEWERK_VERSION=0.4.0 OPENGEWERK_ADDRESS=http://127.0.0.1:23700 sh "$work/docker/start.sh" < /dev/null > /dev/null 2>&1
pulled '0\.4\.0'
check 'Fassung aus der Umgebung geht vor'

# 5. An .env from before #155 says "latest". In a kit that would build with
# no source to build from; setup.sh empties it, and the kit pulls its own.
pin latest
start
pulled '0\.3\.0'
check 'latest aus einer alten .env: das Paket holt seine Fassung'

echo 'Startskript: alles in Ordnung.'
