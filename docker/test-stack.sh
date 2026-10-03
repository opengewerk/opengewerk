#!/bin/sh
# The checks of a running stack, step by step as the CI runs take them:
# "Betrieb über Docker Compose", "Sicherung und Rückspielen" and "Update einer
# laufenden Instanz" (opengewerk-haustechnik#14).
#
#   sh test-stack.sh <step>
#
# The steps belong to the foundation, and every application of the
# organisation runs them against its own stack. What they need to know about
# it comes from its folder: the names from application.env, the database and
# the volumes from compose.yaml, the port from the .env, and what only the
# application knows from test-material.sh beside them, a route that needs a
# sign in, the records a backup has to bring back and the shape of an update.
# Another application names its folder in APPLICATION_DIRECTORY, as for
# start.sh. Its compose.yaml has the services the steps call by name:
# postgres, migrate, app, backup-schedule and, in the profile backup, backup.
#
# The steps run in the order of their CI run, and a later one relies on what
# an earlier one left, a running stack above all. What one hands to the next
# lies in STACK_TEMP, in the CI in RUNNER_TEMP.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

scripts=$(cd "$(dirname "$0")" && pwd)
here=${APPLICATION_DIRECTORY:-$scripts}
temp=${STACK_TEMP:-${RUNNER_TEMP:-/tmp}}
step=${1:-}

# shellcheck source=application.env
. "$here/application.env"

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

compose() {
  docker compose -f "$here/compose.yaml" "$@"
}

# The port on this machine: from the .env once there is one, else the default
# Docker Compose falls back to, read the way setup.sh reads it.
port() {
  found=''

  if [ -f "$here/.env" ]; then
    found=$(grep "^${APPLICATION_PREFIX}_PORT=" "$here/.env" | head -n 1 | cut -d= -f2-)
  fi

  if [ -z "$found" ]; then
    found=$(sed -n "s/.*\${${APPLICATION_PREFIX}_PORT:-\([0-9]*\)}.*/\1/p" "$here/compose.yaml" | head -n 1)
  fi

  printf '%s\n' "$found"
}

base="http://127.0.0.1:$(port)"

# What compose.yaml says, through the configuration Compose builds out of it,
# without interpolation, which needs no .env: the database, and the volumes
# behind the database and the file store, which a lost disk takes away.
facts=$(compose --profile '*' config --no-interpolate --format json | python3 -c '
import json
import shlex
import sys

config = json.load(sys.stdin)
services = config["services"]
volumes = config.get("volumes") or {}


def volume(service, target=None):
    for mount in services[service].get("volumes") or []:
        if mount.get("type") == "volume" and target in (None, mount.get("target")):
            return volumes[mount["source"]]["name"]
    where = target or "einem Pfad"
    sys.exit(f"In compose.yaml hängt am Dienst {service} kein Volume unter {where}.")


storage = services["app"]["environment"]["STORAGE_PATH"]
print("database=" + shlex.quote(services["postgres"]["environment"]["POSTGRES_DB"]))
print("database_volume=" + shlex.quote(volume("postgres")))
print("files_volume=" + shlex.quote(volume("app", storage)))
') || fail "Aus $here/compose.yaml ließen sich Datenbank und Volumes nicht lesen."
eval "$facts"

# A statement as the superuser, whom row level security does not stop: the
# checks look at every tenant at once.
sql() {
  compose exec -T postgres psql --username postgres --dbname "$database" --quiet --command "$1"
}

# What a query returns, without the carriage return a terminal might add. A
# query that fails stops the step: behind a pipe its failure would vanish,
# and an empty answer before and after a restore compares as equal.
value() {
  answer=$(compose exec -T postgres psql --username postgres --dbname "$database" --tuples-only --no-align --command "$1") ||
    fail "Die Abfrage ist gescheitert: $1"
  printf '%s\n' "$answer" | tr -d '\r'
}

# Writes text into the file store of the running application where the store
# keeps it, two levels of directories from the first four characters of its
# hash, and the hash is its name. Prints the hash.
store_file() {
  hash=$(printf '%s' "$1" | sha256sum | cut -d' ' -f1)
  compose exec -T app sh -c 'dir="$STORAGE_PATH/$(printf "%s" "$1" | cut -c1-2)/$(printf "%s" "$1" | cut -c3-4)" && mkdir -p "$dir" && printf "%s" "$2" > "$dir/$1"' sh "$hash" "$1" ||
    fail "Die Datei $hash ließ sich nicht in den Speicher schreiben."
  printf '%s\n' "$hash"
}

# The archives of this application where the backup services write them,
# found by the names the image of the backup gives them.
archives() {
  compose exec -T backup-schedule sh -c '. /usr/local/bin/names.sh && find "$BACKUP_PATH" -maxdepth 1 -name "$archives" | wc -l' | tr -d '\r '
}

# setup.sh and start.sh with the address of this stack, in the variable of
# this application.
with_address() {
  env "${APPLICATION_PREFIX}_ADDRESS=$base" "$@"
}

# The heads of the audit chains, one line per tenant. They are what holds the
# log to an earlier state: a log rewritten to fit itself still has other
# heads.
chains() {
  value "select tenant_id || ':' || next_sequence || ':' || coalesce(head_hash, '-') from audit_chains order by tenant_id"
}

# What a backup has to bring back, written to files named after the moment:
# the rows of the tenants, of the audit log and of the tables the
# application names, the heads of the chains, and every file in the store
# with its hash.
snapshot() {
  # Counted into a variable first: a failure inside the argument of printf
  # would not stop the step.
  for table in tenants $counted_tables audit_entries; do
    rows=$(value "select count(*) from $table")
    printf '%s %s\n' "$table" "$rows"
  done > "$temp/$1.txt"

  chains > "$temp/$1-chains.txt"
  files=$(compose exec -T app sh -c 'cd "$STORAGE_PATH" && find . -type f -exec sha256sum {} \; | sort -k 2') ||
    fail 'Der Dateispeicher ließ sich nicht lesen.'
  printf '%s\n' "$files" | tr -d '\r' > "$temp/$1-files.txt"

  cat "$temp/$1.txt" "$temp/$1-chains.txt"
  echo "Dateien im Speicher: $(wc -l < "$temp/$1-files.txt" | tr -d ' ')"
}

healthy() {
  health=$(curl --silent --fail "$base/health")
  echo "Health: ${health}"

  # No version: a checkout runs "source", which names none (#259).
  test "${health}" = '{"status":"bereit","database":true,"version":null}'
}

# Starts the application again and waits until it answers.
restart_app() {
  compose restart app

  for attempt in $(seq 1 20); do
    if curl --silent --fail "$base/health" | grep -q bereit; then
      return 0
    fi
    sleep 3
  done

  fail 'Die Anwendung wird nach dem Neustart nicht gesund.'
}

# The two tenants the seeds create, under the same ids in every application.
first_tenant='01931c00-0000-7000-8000-000000000001'
second_tenant='01931c00-0000-7000-8000-000000000002'

# What the application says in test-material.sh, and what holds when it says
# nothing.
guarded_route=''
counted_tables=''
migrations=''
older_migrations=''
update_adds='nichts'

records_for_backup() { :; }
records_for_update() { :; }
after_restore() { :; }
after_update() { :; }

[ -f "$here/test-material.sh" ] ||
  fail "In $here fehlt test-material.sh mit dem, was die Prüfungen über die Anwendung wissen müssen."

# shellcheck source=test-material.sh
. "$here/test-material.sh"

case "$step" in

# --- Betrieb über Docker Compose ---------------------------------------------

log-limits)
  # Every service with a limit on its logs (#211), those in a profile
  # included, so that a service added later cannot go without one: nothing
  # else would show it before a full disk does. Read from the configuration
  # Compose builds out of the file, anchors resolved, and without
  # interpolation, which needs no .env and puts no value from one into the
  # output.
  compose --profile '*' config --no-interpolate --format json > "$temp/compose.json"
  python3 - "$temp/compose.json" <<'PYTHON'
import json
import sys

services = json.load(open(sys.argv[1], encoding="utf-8"))["services"]
unbounded = []

for name, service in sorted(services.items()):
    logging = service.get("logging") or {}
    limit = (logging.get("options") or {}).get("max-size")
    print(f"{name}: {logging.get('driver', 'kein Treiber')}, je Datei {limit or 'unbegrenzt'}")
    if not logging.get("driver") or not limit:
        unbounded.append(name)

if not services or unbounded:
    print("Ohne Grenze für die Protokolle: " + (", ".join(unbounded) or "kein Dienst gefunden"))
    sys.exit(1)
PYTHON
  ;;

start)
  # The way an installation starts, with the one command the README names:
  # setup.sh makes every secret and prints only their names, then the
  # migration runs on its own, then the containers start. What it prints is
  # kept for the step on the setup code.
  {
    status=0
    with_address sh "$scripts/start.sh" 2>&1 || status=$?
    echo "$status" > "$temp/start.status"
  } | tee "$temp/start.log"

  [ "$(cat "$temp/start.status")" = 0 ] || fail 'start.sh ist gescheitert, der Grund steht darüber.'
  ;;

env-file)
  # An if and not "! grep": set -e leaves out a negated command, so that line
  # could never fail. A value and not the word, which the comment at the top
  # of the template names too.
  if grep -q '^[A-Z_]*=bitte-ersetzen' "$here/.env"; then
    fail 'In der .env steht noch ein Platzhalter.'
  fi

  mode=$(stat -c %a "$here/.env")
  echo "Rechte der .env: ${mode}"
  test "${mode}" = 600
  echo 'Die .env ist ausgefüllt und nur für ihren Besitzer lesbar.'
  ;;

answers)
  [ -n "$guarded_route" ] ||
    fail 'test-material.sh nennt keine Route, die eine Anmeldung verlangt (guarded_route).'

  healthy

  # Without authentication every route touching data has to refuse. An
  # instance answering 200 here would be handing out the data of a tenant.
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' "$base$guarded_route")
  echo "GET ${guarded_route}: ${status}"
  test "${status}" = 401

  # The migration created the tables, and every one of them is under row
  # level security. One without it would be readable across tenants, and
  # this is the run where that has to show up.
  unprotected=$(value "select count(*) from pg_tables where schemaname = 'public' and not rowsecurity")
  echo "Tabellen ohne Row-Level Security: ${unprotected}"
  test "${unprotected}" = 0
  ;;

first-run)
  # The first run of a fresh instance asks for the setup code from the .env
  # (#215), so that the instance is set up by whoever can get at the server
  # and not by whoever reaches the address first. start.sh says where the
  # code is; the code itself is in no output and in no log. The script reads
  # it from the .env and sends it from there, and prints statuses only, so
  # that it does not reach this log either.
  python3 - "$base" "$here/.env" "$temp/start.log" "$here/compose.yaml" <<'PYTHON'
import json
import subprocess
import sys
import urllib.error
import urllib.request

base, env_file, start_log, compose_file = sys.argv[1:5]


def ask(method, path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as answer:
            return answer.status, json.loads(answer.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"null")


code = ""
with open(env_file, encoding="utf-8") as handle:
    for line in handle:
        if line.startswith("SETUP_CODE="):
            code = line.split("=", 1)[1].strip()

if len(code) != 9:
    print("In der .env steht kein Einrichtungscode der Form XXXX-XXXX.")
    sys.exit(1)

problems = []
started = open(start_log, encoding="utf-8").read()
logs = subprocess.run(
    ["docker", "compose", "-f", compose_file, "logs", "--no-color", "app"],
    capture_output=True, text=True, check=True,
).stdout

if "docker/.env unter SETUP_CODE" not in started:
    problems.append("start.sh sagt nicht, wo der Einrichtungscode steht")

for name, text in (("der Ausgabe von start.sh", started), ("dem Protokoll der Anwendung", logs)):
    if code in text or code.replace("-", "") in text:
        problems.append(f"Der Einrichtungscode steht in {name}")

account = {
    "company": "Probe GmbH",
    "name": "Olga Probe",
    "email": "leitung@probe.example.de",
    "password": "ein-ordentlich-langes-passwort",
}
wrong = "BBBB-BBBB" if code == "AAAA-AAAA" else "AAAA-AAAA"
steps = [
    ("leer vorher", "GET", None, 200, {"needed": True}),
    ("ohne Code", "POST", account, 400, None),
    ("falscher Code", "POST", {**account, "setupCode": wrong}, 403, "Der Einrichtungscode stimmt nicht."),
    ("noch leer", "GET", None, 200, {"needed": True}),
    # Typed the way somebody might: small letters, a space for the dash.
    ("richtiger Code", "POST", {**account, "setupCode": code.lower().replace("-", " ")}, 201, None),
    ("eingerichtet", "GET", None, 200, {"needed": False}),
]

for label, method, body, expected, said in steps:
    status, answer = ask(method, "/setup", body)
    print(f"{label}: {method} /setup {status}")
    if status != expected:
        problems.append(f"{label}: {status} statt {expected}")
    elif isinstance(said, dict) and answer != said:
        problems.append(f"{label}: {answer} statt {said}")
    elif isinstance(said, str) and (answer or {}).get("message") != said:
        problems.append(f"{label}: die Ablehnung sagt nicht: {said}")

if problems:
    print("Nicht in Ordnung:")
    for line in problems:
        print(f"  {line}")
    sys.exit(1)

print("Die Ersteinrichtung nimmt nur den Einrichtungscode aus der .env an.")
PYTHON
  ;;

icons)
  # The icons of both entries, fetched the way a browser and an installed app
  # fetch them (#213): what the two shells link and what their manifests
  # name, read from them rather than listed here, so that a new icon is
  # checked the day it is linked. The image of 0.1.0 had none of these files,
  # and the fallback answered each one with a shell and a 200, so nothing
  # failed. A file that is not there is a 404 since then, and that is asked
  # too.
  python3 - "$base/" <<'PYTHON'
import json
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin

BASE = sys.argv[1]


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as answer:
            return answer.status, answer.headers.get("Content-Type", ""), answer.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type", ""), error.read()


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons = []
        self.manifests = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        rel = (attributes.get("rel") or "").split()
        if tag != "link" or not attributes.get("href"):
            return
        if "icon" in rel or "apple-touch-icon" in rel:
            self.icons.append(attributes["href"])
        if "manifest" in rel:
            self.manifests.append(attributes["href"])


problems = []
icons = {urljoin(BASE, "/brand/favicon.ico")}

for shell in ("/", "/m/"):
    page = urljoin(BASE, shell)
    status, kind, body = fetch(page)
    links = Links()
    links.feed(body.decode("utf-8"))
    icons.update(urljoin(page, href) for href in links.icons)
    if status != 200 or len(links.manifests) != 1:
        problems.append(f"{shell}: {status} {kind}, {len(links.manifests)} Manifeste statt einem")

    for href in links.manifests:
        manifest = urljoin(page, href)
        status, kind, body = fetch(manifest)
        try:
            named = [icon["src"] for icon in json.loads(body)["icons"]]
        except (ValueError, KeyError, TypeError):
            named = []
        print(f"{manifest}: {status} {kind}, {len(named)} Icons")
        if status != 200 or not named:
            problems.append(f"{manifest}: {status} {kind}, kein Manifest mit Icons")
        icons.update(urljoin(manifest, src) for src in named)

for icon in sorted(icons):
    status, kind, body = fetch(icon)
    print(f"{icon}: {status} {kind}, {len(body)} Bytes")
    if status != 200 or not kind.startswith("image/"):
        problems.append(f"{icon}: {status} {kind}")

missing = urljoin(BASE, "/brand/gibt-es-nicht.png")
status, kind, body = fetch(missing)
print(f"{missing}: {status} {kind}")
if status != 404:
    problems.append(f"{missing}: {status} {kind} statt 404")

if problems:
    print("Nicht in Ordnung:")
    for line in problems:
        print(f"  {line}")
    sys.exit(1)
PYTHON
  ;;

# --- Sicherung und Rückspielen and Update einer laufenden Instanz --------------

setup)
  with_address sh "$scripts/setup.sh"
  ;;

keys)
  # The archive is encrypted in this run too, because an untested encryption
  # path is the one that fails on the evening it is needed. The key pair
  # comes from the command the README names, through the image the
  # installation has (#155).
  compose --profile backup build backup
  compose --profile backup run --rm --no-deps -T backup age-keygen > "$temp/key.txt" 2> "$temp/keygen.txt"
  grep -o 'AGE-SECRET-KEY-[A-Z0-9]*' "$temp/key.txt" > "$temp/identity.txt"
  recipient=$(grep -o 'age1[a-z0-9]*' "$temp/keygen.txt" | head -n 1)
  sed -i "s|^BACKUP_AGE_RECIPIENT=.*|BACKUP_AGE_RECIPIENT=${recipient}|" "$here/.env"
  echo "Verschlüsselt an: ${recipient}"
  ;;

up)
  compose up -d --build --wait --wait-timeout 300
  ;;

skips-empty)
  # The schedule checks at once when it starts, and the instance has no
  # tenant yet. After a lost disk that is exactly the state it comes back in,
  # and a backup of it would become the newest archive, the one a restore
  # takes, so the schedule skips it (#130).
  for attempt in $(seq 1 30); do
    if compose logs backup-schedule | grep -q 'übersprungen'; then
      found=$(archives)
      echo "Übersprungen, Archive: ${found}"
      test "${found}" = 0
      exit 0
    fi
    sleep 2
  done

  compose logs backup-schedule
  fail 'Der Zeitplan hat die leere Instanz nicht übersprungen.'
  ;;

seed)
  sql "insert into tenants (id, name) values ('$first_tenant', 'Nord GmbH'), ('$second_tenant', 'Süd GmbH');"

  # Content addressed, so a file name has to be the hash of what is in it.
  # The restore checks exactly that, and a file written any other way would
  # make it fail for the wrong reason.
  compose exec -T app sh -c 'for text in eins zwei drei; do hash=$(printf "%s" "$text" | sha256sum | cut -d" " -f1); printf "%s" "$text" > "$STORAGE_PATH/$hash"; done'

  records_for_backup

  # A tenant written with SQL has no roles yet. The application gives it the
  # ones a tenant begins with when it starts, and after the restore it would
  # do that in the middle of the comparison: restore.sh ends the connections
  # of the running application, which may start again by itself. Started
  # here, so that the backup holds the tenants the way the application keeps
  # them.
  restart_app
  echo 'Zwei Mandanten mit ihren Datensätzen und Dateien angelegt.'
  ;;

snapshot)
  snapshot before
  ;;

backup)
  compose --profile backup run --rm backup backup.sh
  ;;

record)
  # The record every backup leaves, read from inside the application, which
  # sees it read-only and nothing else of the backups (#130).
  compose exec -T app sh -c 'cat "$BACKUP_STATUS_PATH/last.json"' | tee "$temp/last.json"
  grep -q '"finishedEpoch"' "$temp/last.json"
  grep -q '"encrypted": true' "$temp/last.json"
  ;;

lose-data)
  compose --profile backup down --remove-orphans
  docker volume rm "$database_volume" "$files_volume"
  compose up -d --wait --wait-timeout 300

  empty=$(value 'select count(*) from tenants')
  echo "Mandanten in der leeren Instanz: ${empty}"
  test "${empty}" = 0
  ;;

restore)
  compose --profile backup run --rm -v "$temp/identity.txt:/key.txt:ro" -e BACKUP_AGE_IDENTITY=/key.txt backup restore.sh latest
  ;;

compare)
  snapshot after

  # The heads matter most. They were written outside the database, so a log
  # rewritten to fit itself still fails this comparison. The files are
  # compared by their hashes, all of them.
  diff "$temp/before.txt" "$temp/after.txt"
  diff "$temp/before-chains.txt" "$temp/after-chains.txt"
  diff "$temp/before-files.txt" "$temp/after-files.txt"
  echo 'Datenbestand, Audit-Ketten und Dateien stimmen mit der Sicherung überein.'

  # Then the restart restore.sh asks for. The instance has to come back up on
  # the restored data, not merely hold it: "and the application starts with
  # the same data". It writes nothing on its way up, because every tenant
  # has its roles, and the heads of the chains still say so afterwards.
  restart_app
  chains > "$temp/started-chains.txt"
  diff "$temp/before-chains.txt" "$temp/started-chains.txt"
  echo 'Die Anwendung läuft auf dem zurückgespielten Bestand.'
  after_restore
  ;;

corrupt)
  # Overwrite a stretch in the middle of the newest archive. The manifest has
  # to catch that before anything touches the database, because a restore
  # that half succeeds is worse than one that never starts.
  compose --profile backup run --rm --entrypoint sh backup -c '. /usr/local/bin/names.sh && file=$(find "$BACKUP_PATH" -maxdepth 1 -name "$archives" | sort | tail -n 1) && size=$(stat -c %s "$file") && dd if=/dev/urandom of="$file" bs=1 seek=$((size / 2)) count=64 conv=notrunc 2>/dev/null && echo "Byte in $file verändert."'

  if compose --profile backup run --rm -v "$temp/identity.txt:/key.txt:ro" -e BACKUP_AGE_IDENTITY=/key.txt backup restore.sh latest; then
    fail 'Die beschädigte Sicherung wurde angenommen. Das ist der Fehler.'
  fi

  echo 'Die beschädigte Sicherung wurde abgelehnt.'
  ;;

catch-up)
  # A backup is due whenever the last one finished before the most recent
  # 02:30, which is what a machine that was off at night looks like. Taking
  # the record away makes the instance look like that, and the schedule has
  # to catch up on its own, now that the restored instance has tenants in it
  # (#130).
  before=$(archives)
  compose exec -T backup-schedule sh -c 'rm -f "$BACKUP_STATUS_PATH/last.json"'
  compose restart backup-schedule

  for attempt in $(seq 1 60); do
    if compose exec -T backup-schedule sh -c 'test -f "$BACKUP_STATUS_PATH/last.json"'; then
      after=$(archives)
      echo "Archive vorher: ${before}, nachher: ${after}"
      test "${after}" -gt "${before}"
      compose logs backup-schedule | tail -n 15
      exit 0
    fi
    sleep 2
  done

  compose logs backup-schedule
  fail 'Der Zeitplan hat die fehlende Sicherung nicht nachgeholt.'
  ;;

# --- Update einer laufenden Instanz ------------------------------------------

rewind)
  # An older release differs from this one in the one respect that matters
  # for an update: it brought fewer migrations. How many, the application
  # says. What this run cannot show is older application code. The path
  # under test is the database one, so on the older state only the database
  # runs: the application of this checkout may read tables of later
  # migrations when it starts, which an older release never did.
  [ -n "$migrations" ] && [ -n "$older_migrations" ] ||
    fail 'test-material.sh nennt die Migrationen nicht (migrations, older_migrations).'

  python3 - "$migrations" "$older_migrations" "$temp/migrations-old.txt" <<'PYTHON'
import json
import sys
from pathlib import Path

folder, keep, written = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
journal = json.loads((folder / "meta" / "_journal.json").read_text(encoding="utf-8"))
entries = sorted(journal["entries"], key=lambda entry: entry["idx"])

for entry in entries[keep:]:
    (folder / (entry["tag"] + ".sql")).unlink()

journal["entries"] = entries[:keep]
(folder / "meta" / "_journal.json").write_text(json.dumps(journal, indent=2), encoding="utf-8")
written.write_text(str(keep), encoding="utf-8")
print("Zurückgenommen auf " + entries[keep - 1]["tag"] + ".")
PYTHON
  ;;

older)
  compose up -d --wait --wait-timeout 300 postgres
  compose run --rm --build migrate
  ;;

seed-older)
  applied=$(value 'select count(*) from drizzle.__drizzle_migrations')
  echo "Migrationen auf dem alten Stand: ${applied}"
  test "${applied}" = "$(cat "$temp/migrations-old.txt")"

  sql "insert into tenants (id, name) values ('$first_tenant', 'Nord GmbH');"
  records_for_update

  # The head of the audit chain is the strict half of "data intact". It was
  # computed over entries the update passes over, so whatever the update does
  # to the log turns up here.
  chains > "$temp/chains-before.txt"
  cat "$temp/chains-before.txt"
  ;;

update)
  git -C "$migrations" checkout -- .

  # In this order and not through "up" alone. "up" recreates every container
  # whose image changed before it starts any of them, so the serving
  # container would already be gone when the migration runs. The next step is
  # the one that depends on it.
  compose run --rm --build migrate
  compose up -d --build --wait --wait-timeout 300
  ;;

after-update)
  # From the journal rather than a fixed number: the next migration would
  # otherwise break this run with nothing actually wrong.
  applied=$(value 'select count(*) from drizzle.__drizzle_migrations')
  python3 -c 'import json, sys; print(len(json.load(open(sys.argv[1], encoding="utf-8"))["entries"]))' \
    "$migrations/meta/_journal.json" > "$temp/migrations-new.txt"
  echo "Migrationen nach dem Update: ${applied}, erwartet: $(cat "$temp/migrations-new.txt")"
  test "${applied}" = "$(cat "$temp/migrations-new.txt")"

  after_update

  # The head from before is still the entry it was, and nothing came in after
  # it but what the application says the update adds, written by a
  # migration. That the chain goes on unbroken is the check below. Read
  # through a descriptor of its own: a command in the loop would otherwise
  # take the rest of the file as its input.
  while IFS=: read -r tenant next head <&3; do
    kept=$(value "select count(*) from audit_entries where tenant_id = '${tenant}' and sequence = ${next} - 1 and hash = '${head}'")
    echo "Der Kopf der Kette von ${tenant} vor dem Update steht noch: ${kept}"
    test "${kept}" = 1

    added=$(value "select coalesce(string_agg(distinct table_name || ' (' || coalesce(reason, 'ohne Grund') || ')', ', ' order by table_name || ' (' || coalesce(reason, 'ohne Grund') || ')'), 'nichts') from audit_entries where tenant_id = '${tenant}' and sequence >= ${next}")
    echo "Seitdem dazugekommen: ${added}"
    test "${added}" = "${update_adds}"
  done 3< "$temp/chains-before.txt"

  broken=$(value 'select count(*) from tenants t, verify_audit_chain(t.id) v where v.broken_at is not null')
  echo "Mandanten mit gebrochener Kette: ${broken}"
  test "${broken}" = 0

  # The tenant that was there before the update has its roles, one that
  # leads it among them, so that whoever worked in it still may. Which rights
  # each role holds is the test of the migration; counted here they would
  # break this run with the next right, with nothing actually wrong.
  leaderless=$(value 'select count(*) from tenants t where not exists (select 1 from tenant_roles r where r.tenant_id = t.id and r.leads)')
  echo "Mandanten ohne eine Rolle, die führt: ${leaderless}"
  test "${leaderless}" = 0

  healthy
  ;;

broken-update)
  # The mistake this really guards against: a column added without a
  # default. It passes every development database that has no rows in it
  # yet and fails on the first installation that has. On the table of the
  # tenants, which every application has and the run has filled.
  python3 - "$migrations" <<'PYTHON'
import json
import sys
from pathlib import Path

folder = Path(sys.argv[1])
journal = json.loads((folder / "meta" / "_journal.json").read_text(encoding="utf-8"))
entries = sorted(journal["entries"], key=lambda entry: entry["idx"])
last = entries[-1]
tag = "9999_broken_probe"

(folder / (tag + ".sql")).write_text(
    'CREATE TABLE "migration_probe" ("id" uuid PRIMARY KEY);--> statement-breakpoint\n'
    'ALTER TABLE "tenants" ADD COLUMN "credit_limit" numeric(12, 2) NOT NULL;\n',
    encoding="utf-8",
)
entries.append(
    {
        "idx": last["idx"] + 1,
        "version": last["version"],
        "when": last["when"] + 1000,
        "tag": tag,
        "breakpoints": True,
    }
)
journal["entries"] = entries
(folder / "meta" / "_journal.json").write_text(json.dumps(journal, indent=2), encoding="utf-8")
print("Fehlerhafte Migration " + tag + " eingesetzt.")
PYTHON

  before=$(compose ps --quiet app)
  tenants=$(value 'select count(*) from tenants')

  if compose run --rm --build migrate > "$temp/migrate.log" 2>&1; then
    cat "$temp/migrate.log"
    fail 'Die fehlerhafte Migration ging durch. Das ist der Fehler.'
  fi

  # The reason has to stand in the output. Somebody reads this in the moment
  # the update stops, and "Migration fehlgeschlagen" without the statement
  # sends them looking through six files.
  tail -n 25 "$temp/migrate.log"
  grep -q 'Die Migration ist fehlgeschlagen' "$temp/migrate.log"
  grep -q credit_limit "$temp/migrate.log"

  # The instance was never touched: same container, still answering. That is
  # what makes a failed update a postponed one rather than an outage, and it
  # holds only because the migration ran before the swap.
  test "$(compose ps --quiet app)" = "${before}"
  healthy

  # And the database stands where it stood. The first statement of the
  # failed migration went through without complaint, its table is gone all
  # the same, because both were inside one transaction.
  test "$(value 'select count(*) from drizzle.__drizzle_migrations')" = "$(cat "$temp/migrations-new.txt")"
  leftovers=$(value "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'migration_probe'")
  echo "Reste der abgebrochenen Migration: ${leftovers}"
  test "${leftovers}" = 0
  test "$(value 'select count(*) from tenants')" = "${tenants}"
  after_update
  ;;

*)
  fail "Unbekannter Schritt: \"${step}\". Die Schritte stehen in $0."
  ;;
esac
