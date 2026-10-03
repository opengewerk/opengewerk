#!/bin/sh
# Exercises the choice start.sh makes (#155), with a docker that only writes
# down what it was asked: a checkout of the source builds, a release kit pulls
# the version in its compose.yaml and builds nothing, and a version in the .env
# or the environment wins. And what it says about the setup code (#215): where
# it is while the instance is empty, never what it is. And another
# application with these scripts and its own folder (opengewerk-haustechnik#14).
# What the containers then do is the job of the CI run that starts the whole
# stack.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

source_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin" "$work/docker"
cp "$source_dir/start.sh" "$source_dir/setup.sh" "$source_dir/.env.example" \
  "$source_dir/compose.yaml" "$source_dir/application.env" "$work/docker/"

# Every call as one line: the version it saw in the environment, then the
# arguments. Which variable holds the version is the prefix of the application
# that starts, OPENGEWERK_VERSION unless WATCHED names another. "docker compose
# version" answers like the real one does. The one
# question start.sh asks the running application, whether it still waits for
# its first run, is answered with SETUP_NEEDED, false when it is not set and
# nothing at all when it is empty.
cat > "$work/bin/docker" <<'FAKE'
#!/bin/sh
eval "seen=\${${WATCHED:-OPENGEWERK_VERSION}:-}"
printf '%s|%s\n' "$seen" "$*" >> "$CALLS"
case "$*" in
  *' exec -T app '*) printf '%s' "${SETUP_NEEDED-false}" ;;
esac
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

# 6. An instance nobody has set up yet (#215): one line on where the setup
# code is, with the name of the variable and the file, and the code itself in
# none of what start.sh prints.
code=$(grep '^SETUP_CODE=' "$work/docker/.env" | cut -d= -f2-)
test -n "$code"
: > "$CALLS"
out=$(SETUP_NEEDED=true OPENGEWERK_ADDRESS=http://127.0.0.1:23700 sh "$work/docker/start.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
printf '%s' "$out" | grep -q 'Einrichtungscode, er steht in docker/.env unter SETUP_CODE'
if printf '%s' "$out" | grep -qF "$code"; then
  echo 'FEHLER: der Einrichtungscode steht in der Ausgabe'
  exit 1
fi
grep -q '|compose -f .*compose.yaml exec -T app node -e ' "$CALLS"
check 'leere Instanz: nennt, wo der Einrichtungscode steht, und nicht den Code'

# 7. Set up, or no answer at all: not a word about the code.
for answer in false ''; do
  out=$(SETUP_NEEDED=$answer OPENGEWERK_ADDRESS=http://127.0.0.1:23700 sh "$work/docker/start.sh" < /dev/null 2>&1)
  if printf '%s' "$out" | grep -q 'Einrichtungscode'; then
    echo 'FEHLER: eine eingerichtete Instanz bekommt den Hinweis auf den Einrichtungscode'
    exit 1
  fi
done
check 'eingerichtete Instanz: kein Hinweis'

# 8. Another application: the scripts of this folder, its material in a folder
# of its own, named in APPLICATION_DIRECTORY (opengewerk-haustechnik#14). Its
# compose.yaml, its .env, its version variable and its name in every line; the
# version of the first application in the environment changes nothing.
probe="$work/probe"
mkdir -p "$probe"
cat > "$probe/application.env" <<'APPLICATION'
APPLICATION_NAME='Probewerk'
APPLICATION_PREFIX='PROBEWERK'
APPLICATION_EXAMPLE_ADDRESS='https://probewerk.meinbetrieb.de'
APPLICATION
sed 's/OPENGEWERK_/PROBEWERK_/g' "$source_dir/.env.example" > "$probe/.env.example"
sed -e 's/OPENGEWERK_/PROBEWERK_/g' -e 's/PROBEWERK_VERSION:-source}/PROBEWERK_VERSION:-1.0.0}/' \
  "$source_dir/compose.yaml" > "$probe/compose.yaml"

probe_start() {
  : > "$CALLS"
  WATCHED=PROBEWERK_VERSION OPENGEWERK_VERSION=9.9.9 PROBEWERK_ADDRESS=http://127.0.0.1:23900 \
    APPLICATION_DIRECTORY="$probe" sh "$work/docker/start.sh" < /dev/null 2>&1
}

ours=$(sha256sum "$work/docker/.env" | cut -d' ' -f1)
out=$(probe_start)
printf '%s\n' "$out"
grep -q "^1\.0\.0|compose -f $probe/compose.yaml pull --policy missing\$" "$CALLS"
grep -q "^1\.0\.0|compose -f $probe/compose.yaml run --rm migrate\$" "$CALLS"
absent ' build'
absent "$work/docker/compose.yaml"
grep -q '^TRUSTED_ORIGINS=http://127.0.0.1:23900$' "$probe/.env"
test "$(sha256sum "$work/docker/.env" | cut -d' ' -f1)" = "$ours"
if printf '%s\n' "$out" | grep -qv '^Probewerk: '; then
  echo 'FEHLER: eine Zeile beginnt nicht mit dem Namen der Anwendung'
  exit 1
fi
if printf '%s' "$out" | grep -q 'OpenGewerk'; then
  echo 'FEHLER: die zweite Anwendung bekommt den Namen der ersten zu lesen'
  exit 1
fi
check 'zweite Anwendung: ihre compose.yaml und Fassung, ihr Name, die .env der ersten unberührt'

sed 's/^PROBEWERK_VERSION=.*/PROBEWERK_VERSION=1.0.1/' "$probe/.env" > "$probe/.env.new"
mv "$probe/.env.new" "$probe/.env"
probe_start > /dev/null
grep -q "^1\.0\.1|compose -f $probe/compose.yaml pull --policy missing\$" "$CALLS"
check 'zweite Anwendung: ihre Fassung aus ihrer .env geht vor'

# A prefix that is no beginning of a variable stops before anything is called.
printf "APPLICATION_NAME='Probewerk'\nAPPLICATION_PREFIX='PROBE-WERK'\n" > "$probe/application.env"
: > "$CALLS"
if out=$(APPLICATION_DIRECTORY="$probe" sh "$work/docker/start.sh" < /dev/null 2>&1); then
  echo 'FEHLER: ein Präfix mit Bindestrich lief durch'
  exit 1
fi
printf '%s' "$out" | grep -q 'kein Präfix für Variablen'
test ! -s "$CALLS"
check 'zweite Anwendung: falsches Präfix abgelehnt, bevor Docker gefragt wird'

echo 'Startskript: alles in Ordnung.'
