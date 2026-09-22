#!/bin/sh
# Exercises setup.sh in a scratch copy of this folder, for the CI and for
# anybody who changes the script: the first run, a second one, an older .env
# meeting a newer template, and the refusals. Above all it checks that no
# value the script makes appears in what it prints.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

source_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp "$source_dir/setup.sh" "$source_dir/.env.example" "$work/"

check() {
  printf 'check: %s\n' "$1"
}

# 1. The first run, with the address from the environment.
out=$(OPENGEWERK_ADDRESS=http://127.0.0.1:23700 sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
test -f "$work/.env"
! grep -q 'bitte-ersetzen' "$work/.env"
grep -q '^TRUSTED_ORIGINS=http://127.0.0.1:23700$' "$work/.env"
grep -qx 'COMPOSE_PROFILES=renderer' "$work/.env"
check 'erster Lauf: keine Platzhalter, Adresse eingetragen, Renderer eingeschaltet'

for name in POSTGRES_PASSWORD OPENGEWERK_OWNER_PASSWORD OPENGEWERK_APP_PASSWORD RENDERER_TOKEN SESSION_SECRET; do
  value=$(grep "^${name}=" "$work/.env" | cut -d= -f2-)
  printf '%s' "$value" | grep -Eq '^[0-9a-f]{64}$'
  if printf '%s' "$out" | grep -q "$value"; then
    echo "FEHLER: der Wert von $name steht in der Ausgabe"
    exit 1
  fi
done
check 'fünf Schlüssel aus 64 Hexzeichen, keiner in der Ausgabe'

distinct=$(grep -E '^(POSTGRES_PASSWORD|OPENGEWERK_OWNER_PASSWORD|OPENGEWERK_APP_PASSWORD|RENDERER_TOKEN|SESSION_SECRET)=' "$work/.env" | cut -d= -f2- | sort -u | wc -l)
test "$distinct" -eq 5
check 'jeder Schlüssel anders'

# 2. A second run changes nothing.
before=$(sha256sum "$work/.env" | cut -d' ' -f1)
out=$(sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
after=$(sha256sum "$work/.env" | cut -d' ' -f1)
test "$before" = "$after"
printf '%s' "$out" | grep -q 'nichts zu erzeugen'
check 'zweiter Lauf: Datei unverändert'

# 3. An older .env meets a newer template.
grep -v '^CLOSED=' "$work/.env" > "$work/.env.old"
mv "$work/.env.old" "$work/.env"
printf 'NEW_SECRET=bitte-ersetzen-9\n' >> "$work/.env.example"
out=$(sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
grep -q '^CLOSED=false$' "$work/.env"
grep -Eq '^NEW_SECRET=[0-9a-f]{64}$' "$work/.env"
printf '%s' "$out" | grep -q 'Aus der Vorlage übernommen: CLOSED NEW_SECRET'
check 'neuere Vorlage: fehlende Variablen übernommen, neuer Schlüssel erzeugt'

# 4. A renderer switched off stays off. An empty value is a value, and only a
# line that is missing is taken from the template again.
sed 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' "$work/.env" > "$work/.env.off"
mv "$work/.env.off" "$work/.env"
out=$(sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
grep -qx 'COMPOSE_PROFILES=' "$work/.env"
check 'abgeschalteter Renderer: bleibt abgeschaltet'

# 5. No address and nobody at the terminal: a sentence, and a failure.
rm "$work/.env"
if out=$(sh "$work/setup.sh" < /dev/null 2>&1); then
  echo 'FEHLER: ohne Adresse lief das Skript durch'
  exit 1
fi
printf '%s\n' "$out"
printf '%s' "$out" | grep -q 'fehlt die Adresse'
check 'ohne Adresse: abgelehnt'

# 6. An address with a path.
rm "$work/.env"
if out=$(OPENGEWERK_ADDRESS=https://opengewerk.example.org/buero sh "$work/setup.sh" < /dev/null 2>&1); then
  echo 'FEHLER: eine Adresse mit Pfad lief durch'
  exit 1
fi
printf '%s' "$out" | grep -q 'hat einen Pfad'
check 'Adresse mit Pfad: abgelehnt'

# 7. A trailing slash is taken off.
rm "$work/.env"
OPENGEWERK_ADDRESS=https://opengewerk.example.org/ sh "$work/setup.sh" < /dev/null > /dev/null 2>&1
grep -q '^TRUSTED_ORIGINS=https://opengewerk.example.org$' "$work/.env"
check 'Schrägstrich am Ende: weggenommen'

echo 'alles geprüft'
