#!/bin/sh
# Prepares the .env next to this script, so that nobody has to fill it in by
# hand.
#
# The first time it copies the template and replaces every placeholder with a
# secret made here, 32 random bytes as hex, and the setup code with a code of
# eight characters somebody can type (#215). Later runs add what a newer
# template brought and leave everything that is set alone, so the script is
# safe to run before every start and every update; `start.sh` does exactly
# that.
#
# The one value it cannot make is the address the instance is reached at. It
# asks for it when somebody is at the terminal, takes it from the variable
# <prefix>_ADDRESS when nobody is, and stops with a sentence otherwise.
#
# What the application is called and how its variables begin come from
# application.env beside the .env (opengewerk-haustechnik#14), with the
# application.env in this folder OPENGEWERK_ADDRESS. The script is the
# foundation's; another application runs it against its own folder by naming
# it in APPLICATION_DIRECTORY.
#
# No secret ever reaches the terminal or a log. Only the names of the values
# that were made are printed; the values are in the .env and nowhere else,
# which is also why the file is readable by its owner only.

set -eu

here=${APPLICATION_DIRECTORY:-$(cd "$(dirname "$0")" && pwd)}
env_file="$here/.env"
template="$here/.env.example"

if [ ! -f "$here/application.env" ]; then
  printf 'In %s fehlt application.env mit den Namen der Anwendung.\n' "$here" >&2
  exit 1
fi

# shellcheck source=application.env
. "$here/application.env"

say() {
  printf '%s: %s\n' "$APPLICATION_NAME" "$*"
}

fail() {
  printf '%s: %s\n' "$APPLICATION_NAME" "$*" >&2
  exit 1
}

# The prefix goes into the names of variables that are read with eval below,
# so it is held to what a name of a variable may be and nothing more.
case "$APPLICATION_PREFIX" in
  '' | [!A-Z]* | *[!A-Z0-9_]*)
    fail "APPLICATION_PREFIX in application.env ist kein Präfix für Variablen: nur Großbuchstaben, Ziffern und Unterstriche."
    ;;
esac

# 32 random bytes as hex. Hex and not base64: the passwords end up inside
# connection strings, where a "/" or "@" splits the address.
secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  else
    return 1
  fi
}

# Random bytes, as many as asked for, from the same two sources.
random_bytes() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand "$1"
  elif [ -r /dev/urandom ]; then
    dd if=/dev/urandom bs="$1" count=1 2>/dev/null
  else
    return 1
  fi
}

# The code the first run asks for (#215): eight characters as XXXX-XXXX, from
# an alphabet without 0, O, 1, I and L, because somebody reads it off a
# terminal and types it into a browser. tr keeps the random bytes that are in
# the alphabet and drops the rest, and every byte value is as likely as any
# other, so every character of the alphabet is too. 512 bytes leave about 60
# of them, and the length is checked all the same.
setup_code() {
  pool=$(random_bytes 512 | LC_ALL=C tr -dc 'ABCDEFGHJKMNPQRSTUVWXYZ23456789')
  code=$(printf '%.8s' "$pool")
  [ "${#code}" -eq 8 ] || return 1
  printf '%.4s-%s\n' "$code" "${code#????}"
}

# The key push messages are signed with (#284): a private key on P-256 as
# PKCS #8 in base64 on one line, not a random string, because a push service
# checks a signature with its public half. Through "pkcs8 -topk8" and not
# straight out of genpkey: asked for DER, genpkey writes an EC key in the older
# SEC1 form. Only openssl makes one here; without it the line stays empty and
# the instance runs without push, rather than not at all.
vapid_key() {
  command -v openssl >/dev/null 2>&1 || return 1
  key=$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 2>/dev/null |
    openssl pkcs8 -topk8 -nocrypt -outform DER 2>/dev/null |
    openssl base64 -A) || return 1
  [ -n "$key" ] || return 1
  printf '%s\n' "$key"
}

# Rewrites the .env through a file next to it and moves that over the old one,
# so that an interrupted run leaves the old file whole rather than half of it.
replace_env() {
  mv "$1" "$env_file"
  chmod 600 "$env_file"
}

[ -f "$template" ] || fail "Die Vorlage $template fehlt. Sie gehört neben application.env in den Ordner docker der Anwendung."

# The address the template carries until the real one is given, read there
# rather than written here a second time.
example_address=$(sed -n 's/^TRUSTED_ORIGINS=//p' "$template" | head -n 1)

umask 077

if [ ! -f "$env_file" ]; then
  cp "$template" "$env_file"
  say "docker/.env aus der Vorlage angelegt."
fi

chmod 600 "$env_file"

# A last line without a line end would swallow the first line appended below.
if [ -n "$(tail -c 1 "$env_file")" ]; then
  printf '\n' >> "$env_file"
fi

# What a newer template brought: every variable the .env does not have yet,
# with the value from the template. A placeholder among them is made below
# like any other.
added=''

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '' | \#*) continue ;;
  esac

  name=${line%%=*}

  if ! grep -q "^${name}=" "$env_file"; then
    printf '%s\n' "$line" >> "$env_file"
    added="$added $name"
  fi
done < "$template"

if [ -n "$added" ]; then
  say "Aus der Vorlage übernommen:$added"
fi

# "latest" was the value of OPENGEWERK_VERSION in the template until #155 and
# never named a version. Kept, it would make a release kit build, and a kit
# has no source to build from; empty runs what the kit or the checkout brings.
version_variable="${APPLICATION_PREFIX}_VERSION"

if grep -q "^${version_variable}=latest[[:space:]]*\$" "$env_file"; then
  draft=$(mktemp "$here/.env.XXXXXX")
  trap 'rm -f "$draft"' EXIT
  sed "s/^${version_variable}=latest[[:space:]]*\$/${version_variable}=/" "$env_file" > "$draft"
  replace_env "$draft"
  say "$version_variable stand auf latest, der früheren Vorgabe, und ist jetzt leer: ein Paket läuft damit in seiner Fassung, ein Checkout baut aus dem Quelltext."
fi

# Every placeholder becomes a secret of its own. The loop reads from a file
# and writes to one, with no pipe in between: behind a pipe it would run in a
# subshell, and the list of names would be empty afterwards.
made=''
without_push=''
draft=$(mktemp "$here/.env.XXXXXX")
trap 'rm -f "$draft"' EXIT

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    \#*)
      printf '%s\n' "$line"
      ;;
    SETUP_CODE=bitte-ersetzen*)
      value=$(setup_code) || fail 'Es ließ sich kein Einrichtungscode erzeugen, weder openssl noch /dev/urandom ist verfügbar. docker/.env ist unverändert.'
      printf 'SETUP_CODE=%s\n' "$value"
      made="$made SETUP_CODE"
      ;;
    VAPID_PRIVATE_KEY=bitte-ersetzen*)
      if value=$(vapid_key); then
        printf 'VAPID_PRIVATE_KEY=%s\n' "$value"
        made="$made VAPID_PRIVATE_KEY"
      else
        printf 'VAPID_PRIVATE_KEY=\n'
        without_push=1
      fi
      ;;
    *=bitte-ersetzen*)
      name=${line%%=*}
      value=$(secret) || fail 'Es ließ sich kein Schlüssel erzeugen, weder openssl noch /dev/urandom ist verfügbar. docker/.env ist unverändert.'
      printf '%s=%s\n' "$name" "$value"
      made="$made $name"
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$env_file" > "$draft"

if [ -n "$made" ] || [ -n "$without_push" ]; then
  replace_env "$draft"

  if [ -n "$made" ]; then
    say "Schlüssel erzeugt und in docker/.env eingetragen:$made"
    say 'Die Werte stehen nur in dieser Datei, und sie gehört in die Sicherung: ohne SESSION_SECRET lassen sich nach dem Rückspielen weder die zweiten Faktoren noch die Passwörter der Mailserver lesen.'
  fi
else
  rm -f "$draft"
  say 'Alle Schlüssel in docker/.env sind gesetzt, es war nichts zu erzeugen.'
fi

if [ -n "$without_push" ]; then
  say "Ohne openssl ließ sich kein Schlüssel für Push-Nachrichten erzeugen. VAPID_PRIVATE_KEY bleibt leer, und $APPLICATION_NAME läuft ohne Push; den Befehl für einen Schlüssel nennt docker/.env.example."
fi

# The address, the one value nothing here can make up.
address=$(grep '^TRUSTED_ORIGINS=' "$env_file" | head -n 1 | cut -d= -f2-)

if [ -z "$address" ] || [ "$address" = "$example_address" ]; then
  # The port from the .env, else the default Docker Compose falls back to.
  port=$(grep "^${APPLICATION_PREFIX}_PORT=" "$env_file" | head -n 1 | cut -d= -f2-)

  if [ -z "$port" ]; then
    port=$(sed -n "s/.*\${${APPLICATION_PREFIX}_PORT:-\([0-9]*\)}.*/\1/p" "$here/compose.yaml" 2>/dev/null | head -n 1)
  fi

  address_variable="${APPLICATION_PREFIX}_ADDRESS"
  eval "wanted=\${${address_variable}:-}"

  if [ -z "$wanted" ] && [ -t 0 ]; then
    printf '%s: Unter welcher Adresse wird %s im Browser geöffnet?\n' "$APPLICATION_NAME" "$APPLICATION_NAME"
    printf '  Etwa %s. Leer lassen für http://localhost%s: ' "$APPLICATION_EXAMPLE_ADDRESS" "${port:+:$port}"
    read -r wanted || wanted=''
    wanted=${wanted:-http://localhost${port:+:$port}}
  fi

  if [ -z "$wanted" ]; then
    fail "In docker/.env fehlt die Adresse, unter der $APPLICATION_NAME erreichbar ist (TRUSTED_ORIGINS). Das Skript einmal im Terminal starten, dann fragt es danach, oder $address_variable setzen."
  fi

  # An origin and nothing more: a path or a trailing slash never matches what
  # a browser sends, and the sign in would fail without saying why.
  wanted=${wanted%/}

  case "$wanted" in
    http://*/* | https://*/*)
      fail "\"$wanted\" hat einen Pfad. Gebraucht wird nur die Adresse, etwa $APPLICATION_EXAMPLE_ADDRESS."
      ;;
    http://?* | https://?*) ;;
    *)
      fail "\"$wanted\" ist keine Adresse mit http:// oder https:// davor."
      ;;
  esac

  draft=$(mktemp "$here/.env.XXXXXX")

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      TRUSTED_ORIGINS=*) printf 'TRUSTED_ORIGINS=%s\n' "$wanted" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$env_file" > "$draft"

  replace_env "$draft"
  say "Adresse eingetragen: $wanted"
fi
