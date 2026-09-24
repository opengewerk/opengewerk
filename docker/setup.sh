#!/bin/sh
# Prepares the .env next to this script, so that nobody has to fill it in by
# hand.
#
# The first time it copies the template and replaces every placeholder with a
# secret made here, 32 random bytes as hex. Later runs add what a newer
# template brought and leave everything that is set alone, so the script is
# safe to run before every start and every update; `start.sh` does exactly
# that.
#
# The one value it cannot make is the address the instance is reached at. It
# asks for it when somebody is at the terminal, takes it from
# OPENGEWERK_ADDRESS when nobody is, and stops with a sentence otherwise.
#
# No secret ever reaches the terminal or a log. Only the names of the values
# that were made are printed; the values are in the .env and nowhere else,
# which is also why the file is readable by its owner only.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
env_file="$here/.env"
template="$here/.env.example"
example_address='https://opengewerk.example.de'

say() {
  printf 'OpenGewerk: %s\n' "$*"
}

fail() {
  printf 'OpenGewerk: %s\n' "$*" >&2
  exit 1
}

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

# Rewrites the .env through a file next to it and moves that over the old one,
# so that an interrupted run leaves the old file whole rather than half of it.
replace_env() {
  mv "$1" "$env_file"
  chmod 600 "$env_file"
}

[ -f "$template" ] || fail "Die Vorlage $template fehlt. Das Skript gehört in den Ordner docker des Repositorys."

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
if grep -q '^OPENGEWERK_VERSION=latest[[:space:]]*$' "$env_file"; then
  draft=$(mktemp "$here/.env.XXXXXX")
  trap 'rm -f "$draft"' EXIT
  sed 's/^OPENGEWERK_VERSION=latest[[:space:]]*$/OPENGEWERK_VERSION=/' "$env_file" > "$draft"
  replace_env "$draft"
  say 'OPENGEWERK_VERSION stand auf latest, der früheren Vorgabe, und ist jetzt leer: ein Paket läuft damit in seiner Fassung, ein Checkout baut aus dem Quelltext.'
fi

# Every placeholder becomes a secret of its own. The loop reads from a file
# and writes to one, with no pipe in between: behind a pipe it would run in a
# subshell, and the list of names would be empty afterwards.
made=''
draft=$(mktemp "$here/.env.XXXXXX")
trap 'rm -f "$draft"' EXIT

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    \#*)
      printf '%s\n' "$line"
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

if [ -n "$made" ]; then
  replace_env "$draft"
  say "Schlüssel erzeugt und in docker/.env eingetragen:$made"
  say 'Die Werte stehen nur in dieser Datei, und sie gehört in die Sicherung: ohne SESSION_SECRET lassen sich nach dem Rückspielen weder die zweiten Faktoren noch die Passwörter der Mailserver lesen.'
else
  rm -f "$draft"
  say 'Alle Schlüssel in docker/.env sind gesetzt, es war nichts zu erzeugen.'
fi

# The address, the one value nothing here can make up.
address=$(grep '^TRUSTED_ORIGINS=' "$env_file" | head -n 1 | cut -d= -f2-)

if [ -z "$address" ] || [ "$address" = "$example_address" ]; then
  port=$(grep '^OPENGEWERK_PORT=' "$env_file" | head -n 1 | cut -d= -f2-)
  port=${port:-23700}
  wanted=${OPENGEWERK_ADDRESS:-}

  if [ -z "$wanted" ] && [ -t 0 ]; then
    printf 'OpenGewerk: Unter welcher Adresse wird OpenGewerk im Browser geöffnet?\n'
    printf '  Etwa https://opengewerk.meinbetrieb.de. Leer lassen für http://localhost:%s: ' "$port"
    read -r wanted || wanted=''
    wanted=${wanted:-http://localhost:$port}
  fi

  if [ -z "$wanted" ]; then
    fail "In docker/.env fehlt die Adresse, unter der OpenGewerk erreichbar ist (TRUSTED_ORIGINS). Das Skript einmal im Terminal starten, dann fragt es danach, oder OPENGEWERK_ADDRESS setzen."
  fi

  # An origin and nothing more: a path or a trailing slash never matches what
  # a browser sends, and the sign in would fail without saying why.
  wanted=${wanted%/}

  case "$wanted" in
    http://*/* | https://*/*)
      fail "\"$wanted\" hat einen Pfad. Gebraucht wird nur die Adresse, etwa https://opengewerk.meinbetrieb.de."
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
