#!/bin/sh
# Exercises setup.sh in a scratch copy of this folder, for the CI and for
# anybody who changes the script: the first run, a second one, an older .env
# meeting a newer template, and the refusals. Above all it checks that no
# value the script makes appears in what it prints. And that another
# application can run it against its own folder (opengewerk-haustechnik#14).
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

source_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp "$source_dir/setup.sh" "$source_dir/.env.example" "$source_dir/application.env" "$work/"

check() {
  printf 'check: %s\n' "$1"
}

# 1. The first run, with the address from the environment.
out=$(OPENGEWERK_ADDRESS=http://127.0.0.1:23700 sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
test -f "$work/.env"
# An if and not "! grep": set -e leaves out a negated command, so that line
# could never fail. A value and not the word, which the comment at the top of
# the template names too.
if grep -q '^[A-Z_]*=bitte-ersetzen' "$work/.env"; then
  echo 'FEHLER: in der .env steht noch ein Platzhalter'
  exit 1
fi
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

# The setup code (#215): eight characters to type, without 0, O, 1, I and L,
# and not in the output either.
code=$(grep '^SETUP_CODE=' "$work/.env" | cut -d= -f2-)
printf '%s' "$code" | grep -Eq '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$'
if printf '%s' "$out" | grep -qF "$code"; then
  echo 'FEHLER: der Einrichtungscode steht in der Ausgabe'
  exit 1
fi
printf '%s' "$out" | grep -q 'eingetragen:.* SETUP_CODE'
check 'Einrichtungscode: XXXX-XXXX ohne verwechselbare Zeichen, nicht in der Ausgabe'

# The key for push (#284): a private key on P-256 in PKCS #8, and not in the
# output either. "pkcs8" and not "pkey" for the form: pkey reads the older SEC1
# form as well, which the application refuses, and a check with it passed while
# every instance it made failed to start.
vapid=$(grep '^VAPID_PRIVATE_KEY=' "$work/.env" | cut -d= -f2-)
printf '%s' "$vapid" | openssl base64 -d -A | openssl pkcs8 -nocrypt -inform DER -outform PEM > /dev/null 2>&1
printf '%s' "$vapid" | openssl base64 -d -A | openssl pkey -inform DER -noout -text 2>/dev/null | grep -q prime256v1
if printf '%s' "$out" | grep -qF "$vapid"; then
  echo 'FEHLER: der Schlüssel für Push steht in der Ausgabe'
  exit 1
fi
printf '%s' "$out" | grep -q 'eingetragen:.* VAPID_PRIVATE_KEY'
check 'Schlüssel für Push: auf P-256, nicht in der Ausgabe'

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

# 4. An .env from before #215 has no setup code. It gets one on the next
# start, like any key a newer template brings, and in the same form.
grep -v '^SETUP_CODE=' "$work/.env" > "$work/.env.old"
mv "$work/.env.old" "$work/.env"
out=$(sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
grep -Eq '^SETUP_CODE=[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$' "$work/.env"
printf '%s' "$out" | grep -q 'Aus der Vorlage übernommen: SETUP_CODE'
code=$(grep '^SETUP_CODE=' "$work/.env" | cut -d= -f2-)
if printf '%s' "$out" | grep -qF "$code"; then
  echo 'FEHLER: der Einrichtungscode steht in der Ausgabe'
  exit 1
fi
check 'ältere .env ohne Einrichtungscode: bekommt einen'

# 4b. An .env from before #284 has no key for push, and gets one the same way.
grep -v '^VAPID_PRIVATE_KEY=' "$work/.env" > "$work/.env.old"
mv "$work/.env.old" "$work/.env"
out=$(sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
printf '%s' "$out" | grep -q 'Aus der Vorlage übernommen: VAPID_PRIVATE_KEY'
vapid=$(grep '^VAPID_PRIVATE_KEY=' "$work/.env" | cut -d= -f2-)
printf '%s' "$vapid" | openssl base64 -d -A | openssl pkcs8 -nocrypt -inform DER -outform PEM > /dev/null 2>&1
check 'ältere .env ohne Schlüssel für Push: bekommt einen'

# 5. A renderer switched off stays off. An empty value is a value, and only a
# line that is missing is taken from the template again.
sed 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' "$work/.env" > "$work/.env.off"
mv "$work/.env.off" "$work/.env"
out=$(sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
grep -qx 'COMPOSE_PROFILES=' "$work/.env"
check 'abgeschalteter Renderer: bleibt abgeschaltet'

# 6. An .env from before #155 still says "latest", which never named a
# version. It becomes empty, and a version somebody chose stays.
sed 's/^OPENGEWERK_VERSION=.*/OPENGEWERK_VERSION=latest/' "$work/.env" > "$work/.env.old"
mv "$work/.env.old" "$work/.env"
out=$(sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
grep -qx 'OPENGEWERK_VERSION=' "$work/.env"
printf '%s' "$out" | grep -q 'stand auf latest'
sed 's/^OPENGEWERK_VERSION=.*/OPENGEWERK_VERSION=0.2.0/' "$work/.env" > "$work/.env.pinned"
mv "$work/.env.pinned" "$work/.env"
sh "$work/setup.sh" < /dev/null > /dev/null 2>&1
grep -qx 'OPENGEWERK_VERSION=0.2.0' "$work/.env"
check 'latest aus einer alten .env: jetzt leer, eine gewählte Fassung bleibt'

# 7. No address and nobody at the terminal: a sentence, and a failure.
rm "$work/.env"
if out=$(sh "$work/setup.sh" < /dev/null 2>&1); then
  echo 'FEHLER: ohne Adresse lief das Skript durch'
  exit 1
fi
printf '%s\n' "$out"
printf '%s' "$out" | grep -q 'fehlt die Adresse'
check 'ohne Adresse: abgelehnt'

# 8. An address with a path.
rm "$work/.env"
if out=$(OPENGEWERK_ADDRESS=https://opengewerk.example.org/buero sh "$work/setup.sh" < /dev/null 2>&1); then
  echo 'FEHLER: eine Adresse mit Pfad lief durch'
  exit 1
fi
printf '%s' "$out" | grep -q 'hat einen Pfad'
check 'Adresse mit Pfad: abgelehnt'

# 9. A trailing slash is taken off.
rm "$work/.env"
OPENGEWERK_ADDRESS=https://opengewerk.example.org/ sh "$work/setup.sh" < /dev/null > /dev/null 2>&1
grep -q '^TRUSTED_ORIGINS=https://opengewerk.example.org$' "$work/.env"
check 'Schrägstrich am Ende: weggenommen'

# 10. Another application runs the same script against its own folder
# (opengewerk-haustechnik#14): its name at the start of every line, its prefix
# for its own variables, the address of its own template, and nothing of this
# one's, not even when the variables of this one are set as well.
probe="$work/probe"
mkdir -p "$probe"
cat > "$probe/application.env" <<'APPLICATION'
APPLICATION_NAME='Probewerk'
APPLICATION_PREFIX='PROBEWERK'
APPLICATION_EXAMPLE_ADDRESS='https://probewerk.meinbetrieb.de'
APPLICATION
sed -e 's/OPENGEWERK_/PROBEWERK_/g' \
  -e 's|^TRUSTED_ORIGINS=.*|TRUSTED_ORIGINS=https://probewerk.example.de|' \
  "$source_dir/.env.example" > "$probe/.env.example"

ours=$(sha256sum "$work/.env" | cut -d' ' -f1)
out=$(OPENGEWERK_ADDRESS=http://127.0.0.1:23700 PROBEWERK_ADDRESS=http://127.0.0.1:23900 \
  APPLICATION_DIRECTORY="$probe" sh "$work/setup.sh" < /dev/null 2>&1)
printf '%s\n' "$out"
grep -q '^TRUSTED_ORIGINS=http://127.0.0.1:23900$' "$probe/.env"
grep -Eq '^PROBEWERK_OWNER_PASSWORD=[0-9a-f]{64}$' "$probe/.env"
test "$(sha256sum "$work/.env" | cut -d' ' -f1)" = "$ours"
if printf '%s\n' "$out" | grep -qv '^Probewerk: '; then
  echo 'FEHLER: eine Zeile beginnt nicht mit dem Namen der Anwendung'
  exit 1
fi
if printf '%s' "$out" | grep -q 'OpenGewerk'; then
  echo 'FEHLER: die zweite Anwendung bekommt den Namen der ersten zu lesen'
  exit 1
fi
check 'zweite Anwendung: ihr Name, ihre Adresse aus PROBEWERK_ADDRESS, die .env der ersten unberührt'

# Its own version variable, and only that one, comes out of "latest".
sed 's/^PROBEWERK_VERSION=.*/PROBEWERK_VERSION=latest/' "$probe/.env" > "$probe/.env.old"
mv "$probe/.env.old" "$probe/.env"
out=$(APPLICATION_DIRECTORY="$probe" sh "$work/setup.sh" < /dev/null 2>&1)
grep -qx 'PROBEWERK_VERSION=' "$probe/.env"
printf '%s' "$out" | grep -q 'PROBEWERK_VERSION stand auf latest'
check 'zweite Anwendung: ihre Fassung aus latest geleert'

# The address of the first application is no address for the second.
rm "$probe/.env"
if out=$(OPENGEWERK_ADDRESS=http://127.0.0.1:23700 APPLICATION_DIRECTORY="$probe" sh "$work/setup.sh" < /dev/null 2>&1); then
  echo 'FEHLER: die zweite Anwendung nahm die Adresse der ersten'
  exit 1
fi
printf '%s' "$out" | grep -q 'oder PROBEWERK_ADDRESS setzen'
check 'zweite Anwendung: OPENGEWERK_ADDRESS gilt nicht für sie'

# A prefix that is no beginning of a variable, and a folder without names.
printf "APPLICATION_NAME='Probewerk'\nAPPLICATION_PREFIX='probewerk'\n" > "$probe/application.env"
if out=$(PROBEWERK_ADDRESS=http://127.0.0.1:23900 APPLICATION_DIRECTORY="$probe" sh "$work/setup.sh" < /dev/null 2>&1); then
  echo 'FEHLER: ein Präfix aus Kleinbuchstaben lief durch'
  exit 1
fi
printf '%s' "$out" | grep -q 'kein Präfix für Variablen'
rm "$probe/application.env"
if out=$(APPLICATION_DIRECTORY="$probe" sh "$work/setup.sh" < /dev/null 2>&1); then
  echo 'FEHLER: ohne application.env lief das Skript durch'
  exit 1
fi
printf '%s' "$out" | grep -q 'fehlt application.env'
check 'zweite Anwendung: falsches Präfix und fehlende Namen abgelehnt'

echo 'alles geprüft'
