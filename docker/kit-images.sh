#!/bin/sh
# Writes the version of a release into the compose.yaml of its kit (#155), and
# with the digests the release pushed, each image of the application as
# "<image>:<version>@sha256:..." (#687, found in the security review
# opengewerk-haustechnik#360). A tag names whatever was pushed under it last; a
# digest names these bytes, and start.sh checks their signature before it
# pulls them.
#
#   sh kit-images.sh <compose.yaml> <prefix> <version> [<image>@sha256:<digest> ...]
#
# Without digests only the version is written, as the run of the CI that
# packs and starts a kit with images it built itself does: those have no
# digest from a registry. Every application of the organisation packs its
# kit with this script, so that start.sh finds the same form in each.
set -eu

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

compose=${1:-}
prefix=${2:-}
version=${3:-}
[ -f "$compose" ] || fail "compose.yaml fehlt: $compose"
printf '%s' "$prefix" | grep -Eq '^[A-Z][A-Z0-9_]*$' || fail "Kein Präfix für Variablen: $prefix"
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "Die Fassung $version hat nicht die Form 1.2.3."
shift 3

sed -i "s/${prefix}_VERSION:-source}/${prefix}_VERSION:-${version}}/" "$compose"

if grep -q "${prefix}_VERSION:-source}" "$compose" ||
  ! grep -Fq "${prefix}_VERSION:-${version}}" "$compose"; then
  fail "compose.yaml im Paket nennt nicht überall die Fassung $version."
fi

for pinned in "$@"; do
  image=${pinned%@*}
  digest=${pinned#*@}
  printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail "Kein Digest: $pinned"

  before="image: ${image}:\${${prefix}_VERSION:-${version}}"
  grep -Fq "$before" "$compose" || fail "compose.yaml nennt $image nicht."
  # The | of sed cannot stand in an image name or a digest.
  sed -i "s|image: ${image}:\\\${${prefix}_VERSION:-${version}}|image: ${image}:${version}@${digest}|" "$compose"
done

if [ "$#" -gt 0 ] && grep -Eq "image: [^ ]+:\\$\\{${prefix}_VERSION" "$compose"; then
  fail 'compose.yaml im Paket nennt ein Abbild der Anwendung ohne Digest.'
fi
