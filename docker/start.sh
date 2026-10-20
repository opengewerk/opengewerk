#!/bin/sh
# Starts an instance: the first time, every time after, and after an update.
#
# First the .env, through setup.sh: on the first start every secret is made
# and the address asked for, later only what a newer version brought is
# added. No value is printed, only names.
#
# Then the images (#155). In a release kit the version stands in compose.yaml,
# and the signed images of that release are pulled; a checkout of the source
# has "source" there and builds them. A version in the .env wins over both,
# except over a kit that names its images with their digest (#687): that one
# starts its own version, and checks their signature before it pulls them.
#
# Then the migration on its own, and only after it the containers. That is the
# order docs/betrieb.md explains under "Aktualisieren": `docker compose up -d`
# alone replaces the running application before the migration has even
# started, and a migration that fails leaves the instance standing still
# instead of answering on the state before.
#
# What the application is called and how its variables begin come from
# application.env beside the .env (opengewerk-haustechnik#14). The script is
# the foundation's; another application runs it against its own folder by
# naming it in APPLICATION_DIRECTORY, which the setup script beside this one
# reads from the environment as well.

set -eu

scripts=$(cd "$(dirname "$0")" && pwd)
here=${APPLICATION_DIRECTORY:-$scripts}

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

# The prefix goes into the name of a variable that is read with eval below,
# so it is held to what a name of a variable may be and nothing more.
case "$APPLICATION_PREFIX" in
  '' | [!A-Z]* | *[!A-Z0-9_]*)
    fail 'APPLICATION_PREFIX in application.env ist kein Präfix für Variablen: nur Großbuchstaben, Ziffern und Unterstriche.'
    ;;
esac

command -v docker >/dev/null 2>&1 ||
  fail "Docker fehlt auf dieser Maschine. $APPLICATION_NAME läuft in Docker: https://docs.docker.com/engine/install/"

docker compose version >/dev/null 2>&1 ||
  fail 'Docker Compose fehlt. Es gehört zu jeder aktuellen Docker-Installation und heißt "docker compose", ohne Bindestrich.'

sh "$scripts/setup.sh"

compose() {
  docker compose -f "$here/compose.yaml" "$@"
}

# The version that runs, read the way Docker Compose reads it: from the
# environment, else from the .env, else the default in compose.yaml. A value
# edited by hand may carry a comment, quotes or, from Windows, a carriage
# return, none of which belongs to a version.
version_variable="${APPLICATION_PREFIX}_VERSION"
eval "pinned=\${${version_variable}:-}"

if [ -z "$pinned" ]; then
  pinned=$(sed -n "s/^${version_variable}=//p" "$here/.env" | head -n 1 | sed 's/[[:space:]]#.*//' | tr -d "\r\"' ")
fi

shipped=$(sed -n "s/.*${version_variable}:-\([^}]*\)}.*/\1/p" "$here/compose.yaml" | head -n 1)

# The images a kit names with their digest (#687): the release wrote them as
# "<image>:<version>@sha256:..." with kit-images.sh, and only those are this
# application's. The renderer carries a digest as well, under a tag of its own.
signed=$(sed -n "s/^[[:space:]]*image:[[:space:]]*\([^[:space:]]*:${shipped}@sha256:[0-9a-f]\{64\}\).*/\1/p" "$here/compose.yaml" | sort -u)

if [ -n "$signed" ]; then
  # A kit with digests starts its own version and no other, its images being
  # these bytes. A version in the .env is for a checkout.
  if [ -n "$pinned" ] && [ "$pinned" != "$shipped" ]; then
    say "In der .env steht ${version_variable}=${pinned}. Dieses Paket ist die Fassung ${shipped} und nennt seine Abbilder mit Digest, die Zeile gilt nur für einen Checkout und kann weg."
  fi
  version=$shipped
else
  version=${pinned:-$shipped}
fi

# That the images of a kit are the ones the release workflow of this
# application built and signed, keyless through Sigstore (#687). With cosign
# on the machine a signature that does not hold stops the start before
# anything is pulled; without it the start says how to check by hand. COSIGN
# names another cosign than the one on the PATH.
verify_signatures() {
  [ -n "${APPLICATION_REPOSITORY:-}" ] ||
    fail 'In application.env fehlt APPLICATION_REPOSITORY, ohne sie lässt sich die Signatur der Abbilder nicht prüfen.'

  identity="https://github.com/${APPLICATION_REPOSITORY}/.github/workflows/release.yml@refs/tags/v${version}"
  issuer=https://token.actions.githubusercontent.com
  cosign=${COSIGN:-cosign}

  if command -v "$cosign" >/dev/null 2>&1; then
    for image in $signed; do
      if ! answer=$("$cosign" verify --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" "$image" 2>&1); then
        printf '%s\n' "$answer" >&2
        fail "Die Signatur von $image ließ sich nicht bestätigen, das Abbild stammt nicht sicher aus dem Release der Fassung $version. Geholt und gestartet wird nichts, eine laufende Instanz arbeitet unverändert weiter."
      fi
    done
    say 'Die Signaturen der Abbilder sind geprüft.'
  else
    say 'cosign fehlt auf dieser Maschine, die Signaturen der Abbilder sind nicht geprüft. Von Hand, je Abbild:'
    for image in $signed; do
      say "  cosign verify --certificate-identity $identity --certificate-oidc-issuer $issuer $image"
    done
  fi
}

case "$version" in
  '' | latest | source)
    say 'Die Abbilder werden aus dem Quelltext gebaut.'
    # The backup along with the application: the service that backs up every
    # night would otherwise keep the image of the first start.
    compose build migrate backup-schedule ||
      fail 'Die Abbilder ließen sich nicht bauen, der Grund steht darüber. Eine laufende Instanz arbeitet unverändert weiter.'
    ;;
  *)
    export "$version_variable=$version"
    if [ -n "$signed" ]; then
      verify_signatures
    fi
    say "Fassung $version: die signierten Abbilder werden geholt."
    compose pull --policy missing ||
      fail "Die Abbilder der Fassung $version ließen sich nicht holen, der Grund steht darüber. Gebraucht werden eine Verbindung zu ghcr.io und Docker Compose ab 2.22. Eine laufende Instanz arbeitet unverändert weiter."
    ;;
esac

say 'Die Datenbank wird eingerichtet oder auf den neuen Stand gebracht.'
compose run --rm migrate ||
  fail 'Die Migration ist gescheitert, der Grund steht darüber. Eine laufende Instanz arbeitet unverändert weiter, die Datenbank steht auf dem Stand davor.'

say "$APPLICATION_NAME startet."
compose up -d --wait --wait-timeout 300 ||
  fail "$APPLICATION_NAME ist nicht gestartet. Warum, zeigt: docker compose -f docker/compose.yaml logs app"

address=$(grep '^TRUSTED_ORIGINS=' "$here/.env" | head -n 1 | cut -d= -f2- | cut -d, -f1)
say "$APPLICATION_NAME läuft. Im Browser: $address"

# An instance nobody has set up yet asks for the setup code on its first
# screen (#215). Said here is where it is and never what it is: the code
# stands in the .env and nowhere else, not in this output and not in a log.
# Asked from inside the application container, which has node, so that this
# machine needs neither curl nor wget; a question without an answer, as on a
# closed instance, costs the sentence and nothing more.
needed=$(compose exec -T app node -e 'fetch(`http://127.0.0.1:${process.env.PORT}/setup`).then((answer) => answer.json()).then((body) => console.log(body.needed === true), () => console.log(false))' 2>/dev/null | tr -d '\r') || needed=''

if [ "$needed" = true ]; then
  say 'Die Instanz ist noch leer. Die Einrichtung im Browser fragt nach dem Einrichtungscode, er steht in docker/.env unter SETUP_CODE. Am besten gleich einrichten.'
fi
