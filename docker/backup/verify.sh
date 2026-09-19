#!/bin/sh
# Holds the audit log of the running instance against the heads recorded in a
# backup, without restoring anything.
#
#   docker compose --profile backup run --rm backup verify.sh <archive>
#   docker compose --profile backup run --rm backup verify.sh latest
#
# This is the one check the chain inside the database cannot perform on
# itself. Somebody with the rights to switch the trigger off can change an
# entry and recompute every hash from there on, and the chain fits again. What
# they cannot reach is a head written somewhere else at an earlier time: it
# pins every entry up to its own position, and a rewritten log disagrees with
# it.
#
# So the question here is not "does the chain add up" but "is entry number N
# still the entry number N that this backup saw". A mismatch means the log was
# changed after the backup was taken.
#
# Nothing is written, and the application keeps running while this runs.

set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_DB:=opengewerk}"
: "${BACKUP_PATH:=/var/lib/opengewerk/backups}"

wanted="${1:-latest}"

if [ -z "${PGPASSWORD:-}" ]; then
	echo "PGPASSWORD fehlt." >&2
	exit 1
fi

if [ "$wanted" = "latest" ]; then
	archive=$(find "$BACKUP_PATH" -maxdepth 1 -name 'opengewerk-*.tar.gz*' | sort | tail -n 1)

	if [ -z "$archive" ]; then
		echo "Unter $BACKUP_PATH liegt keine Sicherung." >&2
		exit 1
	fi
else
	archive="$wanted"
	[ -f "$archive" ] || archive="${BACKUP_PATH}/${wanted}"

	if [ ! -f "$archive" ]; then
		echo "Die Sicherung \"${wanted}\" gibt es nicht." >&2
		exit 1
	fi
fi

echo "Sicherung: $(basename "$archive")"

work=$(mktemp -d)
cleanup() {
	rm -rf "$work"
}
trap cleanup EXIT

# Only the chain file is needed. The database dump stays packed, which is why
# this takes a second on an archive that takes minutes to restore.
case "$archive" in
*.age)
	if [ -z "${BACKUP_AGE_IDENTITY:-}" ]; then
		echo "Die Sicherung ist verschlüsselt, aber BACKUP_AGE_IDENTITY zeigt auf" >&2
		echo "keine Schlüsseldatei." >&2
		exit 1
	fi

	age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "${work}/archive.tar.gz" "$archive"
	tar --extract --gzip --file "${work}/archive.tar.gz" --directory "$work" ./audit-chains.tsv
	;;
*)
	tar --extract --gzip --file "$archive" --directory "$work" ./audit-chains.tsv
	;;
esac

checked=0
problems=0

while IFS="$(printf '\t')" read -r tenant sequence head; do
	[ -n "$tenant" ] || continue
	checked=$((checked + 1))

	# The head belongs to the last entry the backup saw, which sits one below
	# the next number to be handed out.
	position=$((sequence - 1))

	if [ "$position" -lt 1 ]; then
		echo "  Mandant ${tenant}: zum Zeitpunkt der Sicherung noch kein Eintrag."
		continue
	fi

	current=$(psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
		--tuples-only --no-align --quiet --command \
		"select coalesce(max(hash), '') from audit_entries
		  where tenant_id = '${tenant}' and sequence = ${position}")

	if [ -z "$current" ]; then
		echo "  Mandant ${tenant}: Eintrag ${position} fehlt heute. Er stand in der" >&2
		echo "  Sicherung, also wurde das Log seitdem gekürzt." >&2
		problems=$((problems + 1))
		continue
	fi

	if [ "$current" != "$head" ]; then
		echo "  Mandant ${tenant}: Eintrag ${position} hat heute einen anderen" >&2
		echo "  Fingerabdruck als zum Zeitpunkt der Sicherung." >&2
		echo "    Sicherung: ${head}" >&2
		echo "    heute:     ${current}" >&2
		problems=$((problems + 1))
		continue
	fi

	echo "  Mandant ${tenant}: Eintrag ${position} unverändert."
done <"${work}/audit-chains.tsv"

if [ "$problems" -gt 0 ]; then
	echo "Bei ${problems} von ${checked} Mandant(en) weicht das Audit-Log von der" >&2
	echo "Sicherung ab. Das Log wurde nach der Sicherung verändert." >&2
	exit 1
fi

echo "${checked} Mandant(en) geprüft, das Audit-Log deckt sich mit der Sicherung."
