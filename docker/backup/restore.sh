#!/bin/sh
# Plays a backup back into an instance, and checks afterwards that what came
# back is what went in.
#
# Usage:
#
#   docker compose --profile backup run --rm backup restore.sh <archive>
#   docker compose --profile backup run --rm backup restore.sh latest
#
# The checks after the restore are the reason this is a script and not a page
# in a manual. A restore that silently produced half a database would be found
# weeks later, by an auditor rather than by an operator.
#
# Three of them, and each answers a question the others cannot:
#
#   the manifest        whether the archive arrived whole
#   the file hashes     whether the file store is intact, which a content
#                       addressed store can answer by itself: the name of a
#                       file is the SHA-256 of what is in it, so a mismatch
#                       needs no database and no application to be found
#   the audit heads     whether the log is the same log. The head was written
#                       outside the database at backup time, so a rewritten
#                       chain that fits internally still fails here
#
# The application is locked out for the duration rather than asked to be
# absent. Counting its connections was the first attempt and it protects
# against nothing: the pool drops an idle connection within seconds, so the
# count reads zero while the application is very much running.

set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_DB:=opengewerk}"
: "${STORAGE_PATH:=/var/lib/opengewerk/storage}"
: "${BACKUP_PATH:=/var/lib/opengewerk/backups}"

wanted="${1:-latest}"

if [ -z "${PGPASSWORD:-}" ]; then
	echo "PGPASSWORD fehlt. Das Rückspielen legt das Schema neu an und meldet sich" >&2
	echo "deshalb als Superuser an." >&2
	exit 1
fi

# --- Find the archive ------------------------------------------------------
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

# --- Unpack, decrypting first when needed ----------------------------------
case "$archive" in
*.age)
	if [ -z "${BACKUP_AGE_IDENTITY:-}" ]; then
		echo "Die Sicherung ist verschlüsselt, aber BACKUP_AGE_IDENTITY zeigt auf" >&2
		echo "keine Schlüsseldatei. Ohne den privaten Schlüssel gibt es keinen Weg" >&2
		echo "an die Daten, und das ist der Zweck der Verschlüsselung." >&2
		exit 1
	fi

	echo "  Sicherung wird entschlüsselt."
	age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "${work}/archive.tar.gz" "$archive"
	tar --extract --gzip --file "${work}/archive.tar.gz" --directory "$work"
	rm -f "${work}/archive.tar.gz"
	;;
*)
	tar --extract --gzip --file "$archive" --directory "$work"
	;;
esac

for part in manifest.json database.dump storage.tar audit-chains.tsv; do
	if [ ! -f "${work}/${part}" ]; then
		echo "In der Sicherung fehlt ${part}. Sie ist unvollständig." >&2
		exit 1
	fi
done

# --- Check 1: did the archive arrive whole? --------------------------------
echo "  Prüfsummen werden geprüft."
for part in database.dump storage.tar audit-chains.tsv; do
	expected=$(sed -n "s/.*\"${part}\": \"\([0-9a-f]*\)\".*/\1/p" "${work}/manifest.json")
	actual=$(sha256sum "${work}/${part}" | cut -d' ' -f1)

	if [ -z "$expected" ]; then
		echo "Im Manifest steht keine Prüfsumme für ${part}." >&2
		exit 1
	fi

	if [ "$expected" != "$actual" ]; then
		echo "Die Prüfsumme von ${part} stimmt nicht. Die Sicherung ist beschädigt," >&2
		echo "es wird nichts zurückgespielt." >&2
		echo "  erwartet: ${expected}" >&2
		echo "  gelesen:  ${actual}" >&2
		exit 1
	fi
done

# --- Lock the application out for the duration ------------------------------
# Counting open connections was the first attempt at this and it protects
# against nothing: the pool closes an idle connection after a few seconds, so
# between two health checks the count is zero while the application is very
# much running. A restore would then go through underneath it.
#
# So the role is locked instead of counted. NOLOGIN keeps new connections out,
# terminating ends the ones that exist, and the superuser doing the restore is
# unaffected because it is a different role. Locking the whole database would
# not work: that shuts out this connection too.
lock_application() {
	psql --host "$POSTGRES_HOST" --username postgres --dbname postgres --quiet \
		--command "alter role opengewerk_app nologin" >/dev/null
	psql --host "$POSTGRES_HOST" --username postgres --dbname postgres --quiet \
		--tuples-only --no-align --command \
		"select pg_terminate_backend(pid) from pg_stat_activity
		  where datname = '${POSTGRES_DB}' and usename = 'opengewerk_app'" >/dev/null
}

unlock_application() {
	psql --host "$POSTGRES_HOST" --username postgres --dbname postgres --quiet \
		--command "alter role opengewerk_app login" >/dev/null
}

# Whatever happens from here, the application gets its login back. A restore
# that fails halfway and leaves the role locked would turn one problem into
# two, and the second one looks like a broken password.
unlock_and_cleanup() {
	unlock_application || true
	cleanup
}
trap unlock_and_cleanup EXIT

echo "  Anwendung wird für die Dauer des Rückspielens ausgesperrt."
lock_application

# --- Restore the database --------------------------------------------------
# --clean --if-exists throws away what is there first. Restoring into a
# database that still holds rows would mix two states, and the result would
# look plausible and be wrong.
echo "  Datenbank wird zurückgespielt."
pg_restore --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
	--clean --if-exists --no-owner --role opengewerk_owner \
	--exit-on-error "${work}/database.dump"

# --- Restore the file store ------------------------------------------------
echo "  Dateispeicher wird zurückgespielt."
mkdir -p "$STORAGE_PATH"

# Read before anything is unpacked. This container runs as root, the
# application does not, so files restored with root's ownership would be
# readable and undeletable for the very process that needs them. The
# directory itself already carries the right owner, so it is the one to ask.
storage_owner=$(stat -c '%u:%g' "$STORAGE_PATH")

find "$STORAGE_PATH" -mindepth 1 -delete
tar --extract --no-same-owner --file "${work}/storage.tar" --directory "$STORAGE_PATH"
chown -R "$storage_owner" "$STORAGE_PATH"

# --- Check 2: is every file still the file its name claims? ----------------
# ADR 0007 asks for a sample. This checks all of them, because it costs
# seconds on the amount of data a trades business keeps and a sample answers
# "probably" where this answers "yes".
echo "  Dateispeicher wird gegen die Hashes geprüft."

# Built as a checklist and handed to sha256sum, rather than compared in a
# loop. A loop behind a pipe runs in a subshell, so its counters are gone by
# the time anybody looks at them, and the check would report nothing while
# appearing to work. sha256sum -c carries the verdict in its exit code.
: >"${work}/expected.sha256"

find "$STORAGE_PATH" -type f | while read -r file; do
	name=$(basename "$file")

	# Only files whose name is a SHA-256 in hex. Anything else is not a stored
	# object and gets no opinion from this check.
	case "$name" in
	*[!0-9a-f]*) continue ;;
	esac
	[ "${#name}" -eq 64 ] || continue

	printf '%s  %s\n' "$name" "$file" >>"${work}/expected.sha256"
done

expected_files=$(wc -l <"${work}/expected.sha256" | tr -d ' ')
files=$(find "$STORAGE_PATH" -type f | wc -l | tr -d ' ')

if [ "$expected_files" -gt 0 ]; then
	# -s rather than --quiet: this runs on busybox, which has the short option
	# and not the long one. On failure the same check runs again without it,
	# because "something is broken" without naming the file leaves an operator
	# to go looking through the whole store by hand.
	if ! sha256sum -cs "${work}/expected.sha256"; then
		echo "Der Inhalt einzelner Dateien passt nicht mehr zu ihrem Namen. In einem" >&2
		echo "inhaltsadressierten Speicher heißt das, sie sind beschädigt:" >&2
		sha256sum -c "${work}/expected.sha256" 2>&1 | grep -v ': OK$' >&2 || true
		exit 1
	fi
fi

echo "    ${files} Datei(en) im Speicher, ${expected_files} davon gegen ihren Hash geprüft."

# --- Check 3: is the audit log the same log? -------------------------------
echo "  Audit-Ketten werden gegen die Sicherung geprüft."
mismatch=0

while IFS="$(printf '\t')" read -r tenant sequence head; do
	[ -n "$tenant" ] || continue

	current=$(psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
		--tuples-only --no-align --quiet --command \
		"select next_sequence || '|' || coalesce(head_hash, '') from audit_chains where tenant_id = '${tenant}'")

	if [ "$current" != "${sequence}|${head}" ]; then
		echo "    Mandant ${tenant}: die Kette weicht von der Sicherung ab." >&2
		echo "      Sicherung:      ${sequence}|${head}" >&2
		echo "      zurückgespielt: ${current}" >&2
		mismatch=$((mismatch + 1))
	fi
done <"${work}/audit-chains.tsv"

if [ "$mismatch" -gt 0 ]; then
	echo "Bei ${mismatch} Mandant(en) passt die Audit-Kette nicht zur Sicherung." >&2
	exit 1
fi

chains=$(wc -l <"${work}/audit-chains.tsv" | tr -d ' ')
echo "    ${chains} Kette(n) stimmen mit der Sicherung überein."

echo "Fertig."
echo "Die Anwendung neu starten, damit sie nicht mit Verbindungen zu einem Stand"
echo "weiterarbeitet, den es so nicht mehr gibt:"
echo "  docker compose restart app"
