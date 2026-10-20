#!/bin/sh
# Writes one backup: the database, the file store and the heads of the audit
# chains, in a single archive.
#
# Three things in here are decisions rather than mechanics.
#
# 1. THE ORDER IS DATABASE FIRST, FILES SECOND, and it is not interchangeable.
#    A row points at a file by its hash. Dumping files first would mean that
#    anything uploaded between the two steps has a row in the dump and no file
#    in the archive: a restored record pointing at nothing. The other way
#    round the worst case is a file nobody references, and an unreferenced
#    file in a content addressed store costs disk and nothing else.
#
# 2. IT CONNECTS AS THE SUPERUSER, not as the owner of the tables. Row level
#    security is FORCEd on every table, and it applies to the owner as well,
#    so a dump taken as the owner would be refused by pg_dump or, worse, come
#    back empty. A backup that is allowed to see less than everything is not a
#    backup.
#
# 3. IT RECORDS THE HEAD OF EVERY AUDIT CHAIN. The chain in the database
#    proves that nobody made a small correction; it cannot prove anything
#    against somebody who rewrites every entry from the changed one onwards,
#    because the rewritten chain fits again. A head kept outside the database
#    pins everything written before it. That is what turns the chain into
#    evidence, and it costs one small file.
#
# And the archive reaches the target only encrypted, and only whole
# (opengewerk-haustechnik#360). The parts are written inside this container,
# readable by nobody but root, and packed and encrypted in one stream into a
# hidden file on the target, which gets the name of an archive at the very
# end. Whatever fails before that takes the hidden file and the parts with it.
# Only then is the name and the SHA-256 of the archive recorded on the
# instance, which restore.sh and verify.sh hold every archive to, see
# archive-checks.sh.
#
# Called with --scheduled by the nightly schedule (schedule.sh), it skips an
# instance that has no tenant: after a lost disk the empty instance would
# otherwise become the newest archive. After every backup it records when it
# finished in BACKUP_STATUS_PATH, which the office reads (#130).

set -eu

# The archive is packed and encrypted in a pipe, and a pipe answers with the
# status of its last command alone: a tar that broke off would leave age to
# encrypt what it got and report success. The shell of the image, busybox sh,
# knows pipefail; a shell that does not stops here rather than without it.
set -o pipefail

# Dump, file store and archive hold every tenant. Nothing written here is for
# anybody but the user running it; the record the office reads is made
# readable on purpose below.
umask 077

scheduled=false

if [ "${1:-}" = "--scheduled" ]; then
	scheduled=true
fi

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_DB:=opengewerk}"
: "${STORAGE_PATH:=/var/lib/opengewerk/storage}"
: "${BACKUP_PATH:=/var/lib/opengewerk/backups}"
: "${BACKUP_KEEP:=14}"

# The names of the archives, in one place for backup, restore and verify.
. "$(dirname "$0")/names.sh"

if [ -z "${PGPASSWORD:-}" ]; then
	echo "PGPASSWORD fehlt. Die Sicherung meldet sich als Superuser an, weil sie" >&2
	echo "sonst wegen der Mandantentrennung leere Tabellen sichern würde." >&2
	exit 1
fi

if [ ! -d "$STORAGE_PATH" ]; then
	echo "Der Dateispeicher unter $STORAGE_PATH fehlt. Ist das Volume eingehängt?" >&2
	exit 1
fi

if [ "$scheduled" = true ]; then
	# A database that is not migrated yet has no table of tenants at all, and
	# nothing in it to back up either.
	migrated=$(psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
		--tuples-only --no-align --quiet --command "select to_regclass('public.tenants') is not null")
	tenants=0

	if [ "$migrated" = "t" ]; then
		tenants=$(psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
			--tuples-only --no-align --quiet --command "select count(*) from tenants")
	fi

	if [ "$tenants" = "0" ]; then
		echo "Keine Mandanten in der Datenbank. Die geplante Sicherung wird übersprungen, damit"
		echo "eine leere Instanz keine ältere Sicherung mit Daten verdrängt. Von Hand geht sie weiter."
		exit 0
	fi
fi

mkdir -p "$BACKUP_PATH"

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
name="${BACKUP_PREFIX}-${stamp}"

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
	archive="${BACKUP_PATH}/${name}.tar.gz.age"
else
	archive="${BACKUP_PATH}/${name}.tar.gz"
fi

# The parts are written here, in the container, and never on the target: on a
# share or a NAS a dump in the clear would lie there for as long as the backup
# runs, and in its snapshots for longer. TMPDIR moves it, for a machine whose
# containers have too little room for a dump and a copy of the file store.
work=$(mktemp -d)

# The archive is written under a hidden name, which the names of archives do
# not match (names.sh), and renamed when it is whole.
partial="${BACKUP_PATH}/.${name}.tmp"
renamed=false
recorded=false

# Anything that fails before the record is written leaves nothing behind on
# the target, neither a half archive nor a whole one nobody recorded: a backup
# directory holding a file that looks like a backup and is none is worse than
# one holding nothing. A signal ends the script through the same way out.
cleanup() {
	rm -rf "$work"
	rm -f "$partial"

	if [ "$renamed" = true ] && [ "$recorded" = false ]; then
		rm -f "$archive"
	fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

echo "Sicherung ${name} wird erstellt."

# busybox sh does not understand $'\t', so the tab is built instead of written.
tab=$(printf '\t')

# --- 1. The database -------------------------------------------------------
# Custom format, because it restores selectively and compresses on the way.
echo "  Datenbank wird gesichert."
pg_dump --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
	--format custom --compress 6 --file "${work}/database.dump"

# --- 2. The heads of the audit chains --------------------------------------
# Read with the same connection, right after the dump, so the heads describe
# the state the dump holds.
echo "  Audit-Ketten werden festgehalten."
psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
	--tuples-only --no-align --field-separator="$tab" --quiet \
	--command "select tenant_id, next_sequence, coalesce(head_hash, '') from audit_chains order by tenant_id" \
	>"${work}/audit-chains.tsv"

# --- 3. The file store -----------------------------------------------------
# After the database, never before it. See the note at the top.
echo "  Dateispeicher wird gesichert."
tar --create --file "${work}/storage.tar" --directory "$STORAGE_PATH" .

# --- 4. The manifest -------------------------------------------------------
# A checksum per part, so that a restore can tell a damaged archive from a
# complete one before it touches a running database.
echo "  Prüfsummen werden berechnet."
database_hash=$(sha256sum "${work}/database.dump" | cut -d' ' -f1)
storage_hash=$(sha256sum "${work}/storage.tar" | cut -d' ' -f1)
chains_hash=$(sha256sum "${work}/audit-chains.tsv" | cut -d' ' -f1)
storage_files=$(find "$STORAGE_PATH" -type f | wc -l | tr -d ' ')
chains=$(wc -l <"${work}/audit-chains.tsv" | tr -d ' ')
server_version=$(psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
	--tuples-only --no-align --quiet --command "show server_version")

cat >"${work}/manifest.json" <<JSON
{
  "name": "${name}",
  "created": "${stamp}",
  "postgres": "${server_version}",
  "order": "database-then-storage",
  "parts": {
    "database.dump": "${database_hash}",
    "storage.tar": "${storage_hash}",
    "audit-chains.tsv": "${chains_hash}"
  },
  "storageFiles": ${storage_files},
  "auditChains": ${chains}
}
JSON

# --- 5. Pack, and encrypt when a key is there ------------------------------
# In one stream into the hidden file: the packed archive in the clear exists
# nowhere, not on the target and not here.
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
	# A public key encrypts, and only the private key decrypts. The machine
	# making backups therefore cannot read its own older ones, which is the
	# point: whoever takes over the server does not get the archive with it.
	echo "  Sicherung wird gepackt und verschlüsselt."
	tar --create --gzip --file - --directory "$work" . |
		age --recipient "$BACKUP_AGE_RECIPIENT" >"$partial"
else
	echo "  WARNUNG: BACKUP_AGE_RECIPIENT ist nicht gesetzt, die Sicherung liegt"
	echo "  unverschlüsselt. Sie enthält Kundendaten und Belege."
	tar --create --gzip --file - --directory "$work" . >"$partial"
fi

# Read back from the target, so that the checksum is the one of what landed
# there.
archive_hash=$(sha256sum "$partial" | cut -d' ' -f1)
archive_bytes=$(stat -c %s "$partial")

# A second backup in the same second would take the name of the first, and
# when it failed after that, the first with it.
if [ -e "$archive" ]; then
	echo "Unter dem Namen $(basename "$archive") liegt schon eine Sicherung. Eine zweite in" >&2
	echo "derselben Sekunde wird nicht geschrieben." >&2
	exit 1
fi

mv "$partial" "$archive"
renamed=true

# --- 6. The record of the archive and the one the office reads -------------
# Both on the instance, never on the target, and both written under a
# temporary name and moved into place: the office never reads a record of a
# backup that is not there, and restore.sh never finds half a line.
# archives.sha256 keeps every archive this instance wrote, also after the
# retention took it off the target, so that one fetched back from elsewhere
# can still be held to it; a line is about a hundred bytes. last.json is read
# by the application, which runs as another user, and is made readable for it.
if [ -n "${BACKUP_STATUS_PATH:-}" ]; then
	# A folder made here has to let the application through to last.json.
	mkdir -p -m 0755 "$BACKUP_STATUS_PATH"
	record="${BACKUP_STATUS_PATH}/archives.sha256"
	encrypted=false

	if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
		encrypted=true
	fi

	{
		if [ -f "$record" ]; then
			cat "$record"
		fi
		printf '%s  %s\n' "$archive_hash" "$(basename "$archive")"
	} >"${record}.tmp"

	cat >"${BACKUP_STATUS_PATH}/.last.json" <<JSON
{
  "finished": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "finishedEpoch": $(date +%s),
  "archive": "$(basename "$archive")",
  "sha256": "${archive_hash}",
  "bytes": ${archive_bytes},
  "encrypted": ${encrypted},
  "storageFiles": ${storage_files},
  "auditChains": ${chains}
}
JSON
	chmod 0644 "${BACKUP_STATUS_PATH}/.last.json"
	mv "${record}.tmp" "$record"
	mv "${BACKUP_STATUS_PATH}/.last.json" "${BACKUP_STATUS_PATH}/last.json"
else
	echo "  WARNUNG: BACKUP_STATUS_PATH ist nicht gesetzt, die Sicherung steht in keinem"
	echo "  Verzeichnis. Zurückspielen lässt sie sich nur mit --skip-origin-check."
fi

recorded=true

# --- 7. Retention ----------------------------------------------------------
# Oldest first, keep the newest BACKUP_KEEP. Sorting by name works because the
# timestamp is the name and it is written in a sortable shape. Only archives of
# this prefix count, see names.sh. After the record, so that a retention that
# fails takes nothing of the new archive back.
if [ "$BACKUP_KEEP" -gt 0 ]; then
	total=$(find "$BACKUP_PATH" -maxdepth 1 -name "$archives" | wc -l | tr -d ' ')
	surplus=$((total - BACKUP_KEEP))

	if [ "$surplus" -gt 0 ]; then
		echo "  ${surplus} alte Sicherung(en) werden entfernt, ${BACKUP_KEEP} bleiben."
		find "$BACKUP_PATH" -maxdepth 1 -name "$archives" | sort | head -n "$surplus" |
			while read -r old; do
				rm -f "$old"
				echo "    entfernt: $(basename "$old")"
			done
	fi
fi

size=$(du -h "$archive" | cut -f1)
echo "Fertig: ${archive} (${size}, ${storage_files} Dateien, ${chains} Mandanten)"
