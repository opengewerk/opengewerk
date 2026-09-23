#!/bin/sh
# Writes one backup: the database, the file store and the heads of the audit
# chains, in a single archive.
#
# Three things in here are decisions rather than mechanics.
#
# 1. THE ORDER IS DATABASE FIRST, FILES SECOND, and it is not interchangeable.
#    A document row points at a file by its hash. Dumping files first would
#    mean that anything uploaded between the two steps has a row in the dump
#    and no file in the archive: a restored invoice pointing at nothing. The
#    other way round the worst case is a file nobody references, and an
#    unreferenced file in a content addressed store costs disk and nothing
#    else.
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
# Called with --scheduled by the nightly schedule (schedule.sh), it skips an
# instance that has no business: after a lost disk the empty instance would
# otherwise become the newest archive. After every backup it records when it
# finished in BACKUP_STATUS_PATH, which the office reads (#130).

set -eu

scheduled=false

if [ "${1:-}" = "--scheduled" ]; then
	scheduled=true
fi

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_DB:=opengewerk}"
: "${STORAGE_PATH:=/var/lib/opengewerk/storage}"
: "${BACKUP_PATH:=/var/lib/opengewerk/backups}"
: "${BACKUP_KEEP:=14}"

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
	businesses=$(psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" \
		--tuples-only --no-align --quiet --command "select count(*) from tenants")

	if [ "$businesses" = "0" ]; then
		echo "Keine Betriebe in der Datenbank. Die geplante Sicherung wird übersprungen, damit"
		echo "eine leere Instanz keine ältere Sicherung mit Daten verdrängt. Von Hand geht sie weiter."
		exit 0
	fi
fi

mkdir -p "$BACKUP_PATH"

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
name="opengewerk-${stamp}"
work="${BACKUP_PATH}/.${name}.work"
rm -rf "$work"
mkdir -p "$work"

# Anything that fails from here on leaves no half archive behind. A backup
# directory holding a truncated file that looks like a backup is worse than
# one holding nothing.
cleanup() {
	rm -rf "$work"
}
trap cleanup EXIT

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
archive="${BACKUP_PATH}/${name}.tar.gz"
tar --create --gzip --file "$archive" --directory "$work" .

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
	# A public key encrypts, and only the private key decrypts. The machine
	# making backups therefore cannot read its own older ones, which is the
	# point: whoever takes over the server does not get the archive with it.
	echo "  Sicherung wird verschlüsselt."
	age --recipient "$BACKUP_AGE_RECIPIENT" --output "${archive}.age" "$archive"
	rm -f "$archive"
	archive="${archive}.age"
else
	echo "  WARNUNG: BACKUP_AGE_RECIPIENT ist nicht gesetzt, die Sicherung liegt"
	echo "  unverschlüsselt. Sie enthält Kundendaten und Belege."
fi

# --- 6. Retention ----------------------------------------------------------
# Oldest first, keep the newest BACKUP_KEEP. Sorting by name works because the
# timestamp is the name and it is written in a sortable shape.
if [ "$BACKUP_KEEP" -gt 0 ]; then
	total=$(find "$BACKUP_PATH" -maxdepth 1 -name 'opengewerk-*.tar.gz*' | wc -l | tr -d ' ')
	surplus=$((total - BACKUP_KEEP))

	if [ "$surplus" -gt 0 ]; then
		echo "  ${surplus} alte Sicherung(en) werden entfernt, ${BACKUP_KEEP} bleiben."
		find "$BACKUP_PATH" -maxdepth 1 -name 'opengewerk-*.tar.gz*' | sort | head -n "$surplus" |
			while read -r old; do
				rm -f "$old"
				echo "    entfernt: $(basename "$old")"
			done
	fi
fi

# --- 7. The record the office reads ---------------------------------------
# Written last, after the archive is complete, and moved into place, so that
# the office never reads a record of a backup that is not there.
if [ -n "${BACKUP_STATUS_PATH:-}" ]; then
	mkdir -p "$BACKUP_STATUS_PATH"
	encrypted=false

	if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
		encrypted=true
	fi

	cat >"${BACKUP_STATUS_PATH}/.last.json" <<JSON
{
  "finished": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "finishedEpoch": $(date +%s),
  "archive": "$(basename "$archive")",
  "bytes": $(stat -c %s "$archive"),
  "encrypted": ${encrypted},
  "storageFiles": ${storage_files},
  "auditChains": ${chains}
}
JSON
	mv "${BACKUP_STATUS_PATH}/.last.json" "${BACKUP_STATUS_PATH}/last.json"
fi

size=$(du -h "$archive" | cut -f1)
echo "Fertig: ${archive} (${size}, ${storage_files} Dateien, ${chains} Mandanten)"
