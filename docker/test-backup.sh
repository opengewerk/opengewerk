#!/bin/sh
# Exercises the names of the archives (opengewerk-haustechnik#14) with the
# backup scripts themselves and stand-ins for the tools of PostgreSQL: an
# archive is named after its database unless BACKUP_PREFIX says otherwise, the
# retention removes only archives of its own prefix, "latest" is the newest of
# its own, and an archive named outright is taken only if it is one of its own.
# All of it in one folder with the archives of another application whose
# prefix begins with this one's, the case a bare "<prefix>-*" gets wrong.
#
# Then what a restore turns away before it asks anything of the database: an
# archive that unpacks cleanly and does not hold what its manifest says
# (opengewerk-haustechnik#31). Whether a whole instance comes back out of an
# archive is the job of the CI run that backs one up and restores it.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

source_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin" "$work/storage" "$work/backups"
cp "$source_dir/backup/backup.sh" "$source_dir/backup/restore.sh" \
  "$source_dir/backup/verify.sh" "$source_dir/backup/names.sh" "$work/bin/"

# A dump with something in it, a database without audit chains and a server
# with a version; whatever else the scripts ask is answered with nothing.
cat > "$work/bin/pg_dump" <<'FAKE'
#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = --file ]; then
    printf 'dump\n' > "$2"
  fi
  shift
done
FAKE
#
# Each writes down that it was called. A restore that is turned away has to be
# turned away before the first of them, the one that locks the application out
# included.
cat > "$work/bin/psql" <<'FAKE'
#!/bin/sh
printf 'psql %s\n' "$*" >> "$CALLS"
case "$*" in
  *server_version*) echo 18 ;;
esac
FAKE
cat > "$work/bin/pg_restore" <<'FAKE'
#!/bin/sh
printf 'pg_restore\n' >> "$CALLS"
FAKE
chmod +x "$work/bin/pg_dump" "$work/bin/psql" "$work/bin/pg_restore"

PATH="$work/bin:$PATH"
PGPASSWORD=probe
STORAGE_PATH="$work/storage"
BACKUP_PATH="$work/backups"
CALLS="$work/calls"
export PATH PGPASSWORD STORAGE_PATH BACKUP_PATH CALLS

check() {
  printf 'check: %s\n' "$1"
}

present() {
  for name in "$@"; do
    if [ ! -f "$work/backups/$name" ]; then
      printf 'FEHLER: %s fehlt\n' "$name"
      ls "$work/backups"
      exit 1
    fi
  done
}

gone() {
  for name in "$@"; do
    if [ -f "$work/backups/$name" ]; then
      printf 'FEHLER: %s ist noch da\n' "$name"
      exit 1
    fi
  done
}

# A command that has to be turned away: it fails, it says why in the words
# given, and it has asked nothing of the database on the way there.
refused() {
  sentence=$1
  shift
  : > "$CALLS"

  if "$@" > "$work/out" 2>&1; then
    printf 'FEHLER: lief durch: %s\n' "$*"
    cat "$work/out"
    exit 1
  fi

  if ! grep -q "$sentence" "$work/out"; then
    printf 'FEHLER: abgelehnt, aber ohne "%s": %s\n' "$sentence" "$*"
    cat "$work/out"
    exit 1
  fi

  if [ -s "$CALLS" ]; then
    printf 'FEHLER: vor der Ablehnung wurde die Datenbank gefragt: %s\n' "$*"
    cat "$CALLS"
    exit 1
  fi
}

# The same, for a command that has to go through.
taken() {
  if ! "$@" > "$work/out" 2>&1; then
    printf 'FEHLER: abgelehnt: %s\n' "$*"
    cat "$work/out"
    exit 1
  fi
}

# Two older archives of this application, two of another whose prefix begins
# with this one's and a hyphen, and a file that only looks like an archive.
# Sorted by name, every one of the others comes after the newest of this one.
older='opengewerk-2026-01-01T000000Z.tar.gz'
old='opengewerk-2026-01-02T000000Z.tar.gz.age'
theirs_older='opengewerk-haustechnik-2026-01-03T000000Z.tar.gz'
theirs='opengewerk-haustechnik-2026-01-04T000000Z.tar.gz.age'
lookalike='opengewerk-notizen.tar.gz'

for name in "$older" "$old" "$theirs_older" "$theirs" "$lookalike"; do
  : > "$work/backups/$name"
done

# 1. A backup named after its database, and the retention for its own.
POSTGRES_DB=opengewerk BACKUP_KEEP=2 sh "$work/bin/backup.sh" > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
ours=$(sed -n 's|^Fertig: .*/\([^/ ]*\) (.*|\1|p' "$work/out")
printf '%s' "$ours" | grep -Eq '^opengewerk-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gz$'
present "$ours" "$old" "$theirs_older" "$theirs" "$lookalike"
gone "$older"
check 'Sicherung: nach der Datenbank benannt, von den eigenen bleiben die zwei neuesten, fremde unberührt'

# 2. "latest" is the newest of its own, for verify and for restore.
POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" latest > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
grep -qx "Sicherung: $ours" "$work/out"
POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" latest > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
grep -qx "Sicherung: $ours" "$work/out"
check 'latest: die neueste eigene Sicherung, für Prüfen und Rückspielen'

# 3. The other application, through BACKUP_PREFIX: its own retention, and the
# archives of the first stay where they are.
BACKUP_PREFIX=opengewerk-haustechnik POSTGRES_DB=haustechnik BACKUP_KEEP=1 \
  sh "$work/bin/backup.sh" > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
mine=$(sed -n 's|^Fertig: .*/\([^/ ]*\) (.*|\1|p' "$work/out")
printf '%s' "$mine" | grep -Eq '^opengewerk-haustechnik-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gz$'
present "$mine" "$ours" "$old" "$lookalike"
gone "$theirs_older" "$theirs"
BACKUP_PREFIX=opengewerk-haustechnik POSTGRES_DB=haustechnik sh "$work/bin/verify.sh" latest > "$work/out" 2>&1
grep -qx "Sicherung: $mine" "$work/out"
check 'BACKUP_PREFIX: eigene Sicherungen, eigene Aufbewahrung, die der ersten Anwendung unberührt'

# Without BACKUP_PREFIX the name of the database is the prefix, whatever it is.
POSTGRES_DB=haustechnik BACKUP_KEEP=0 sh "$work/bin/backup.sh" > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
named=$(sed -n 's|^Fertig: .*/\([^/ ]*\) (.*|\1|p' "$work/out")
printf '%s' "$named" | grep -Eq '^haustechnik-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gz$'
present "$named" "$mine" "$ours" "$old" "$lookalike"
check 'ohne BACKUP_PREFIX: der Name der Datenbank'

# 4. A prefix that is no beginning of a file name stops before anything is
# written.
before=$(ls "$work/backups" | wc -l)
if BACKUP_PREFIX='../x' POSTGRES_DB=opengewerk sh "$work/bin/backup.sh" > "$work/out" 2>&1; then
  echo 'FEHLER: ein Präfix mit Schrägstrich lief durch'
  exit 1
fi
grep -q 'taugt nicht als Anfang eines Dateinamens' "$work/out"
test "$(ls "$work/backups" | wc -l)" -eq "$before"
check 'falsches Präfix: abgelehnt, nichts geschrieben'

# 5. An archive named outright is held to the names "latest" looks among. The
# archive of the other application lies in the same folder, and by its name or
# by its path it is turned away before anything is asked of the database, in
# both directions, as is the file that only looks like an archive.
foreign='gehört nicht zu dieser Anwendung'
refused "$foreign" env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$mine"
refused "$foreign" env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$work/backups/$mine"
refused "$foreign" env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$named"
refused "$foreign" env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$lookalike"
refused "$foreign" env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" "$mine"
refused "$foreign" env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" "$work/backups/$mine"
refused "$foreign" env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" "$lookalike"
refused "$foreign" env BACKUP_PREFIX=opengewerk-haustechnik POSTGRES_DB=haustechnik \
  sh "$work/bin/restore.sh" "$ours"
refused "$foreign" env BACKUP_PREFIX=opengewerk-haustechnik POSTGRES_DB=haustechnik \
  sh "$work/bin/verify.sh" "$ours"
grep -q 'opengewerk-haustechnik-<Zeit>.tar.gz' "$work/out"
check 'mit Namen genannt: das Archiv einer anderen Anwendung wird abgelehnt, die Datenbank nicht gefragt'

# Its own it takes, by name and by path. The encrypted one gets as far as the
# question for the key, which this run has none of: its name did not stop it.
taken env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
grep -qx "Sicherung: $ours" "$work/out"
taken env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" "$work/backups/$ours"
grep -qx "Sicherung: $ours" "$work/out"
taken env BACKUP_PREFIX=opengewerk-haustechnik POSTGRES_DB=haustechnik sh "$work/bin/restore.sh" "$mine"
grep -qx "Sicherung: $mine" "$work/out"
refused 'BACKUP_AGE_IDENTITY' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$old"
grep -qx "Sicherung: $old" "$work/out"
check 'mit Namen genannt: das eigene Archiv wird genommen'

# 6. An archive that unpacks cleanly and does not hold what its manifest says.
# A changed byte in the packed file would not get as far as the manifest: gzip
# carries a checksum of its own, and an encrypted archive is authenticated by
# age. What only the manifest can notice is a part that is not the part the
# backup wrote, inside packing that is whole. So each one is unpacked, changed
# and packed again here, and turned away before anything is asked of the
# database.
pristine="$work/pristine.tar.gz"
cp "$work/backups/$ours" "$pristine"

# Unpacks the archive as the backup wrote it, runs the change on its parts
# and packs it again under its own name.
repacked() {
  rm -rf "$work/unpacked"
  mkdir "$work/unpacked"
  tar --extract --gzip --file "$pristine" --directory "$work/unpacked"
  (cd "$work/unpacked" && "$@")
  tar --create --gzip --file "$work/backups/$ours" --directory "$work/unpacked" .
}

one_byte_more() {
  printf 'x' >> "$1"
}

without_its_checksum() {
  grep -v "\"$1\"" manifest.json > manifest.new
  mv manifest.new manifest.json
}

for part in database.dump storage.tar audit-chains.tsv; do
  repacked one_byte_more "$part"
  refused "Die Prüfsumme von $part stimmt nicht" env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
  refused "Die Prüfsumme von $part stimmt nicht" env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" latest
done
check 'Manifest: ein veränderter Teil in einem heilen Archiv wird abgelehnt, die Datenbank nicht gefragt'

repacked without_its_checksum storage.tar
refused 'Im Manifest steht keine Prüfsumme für storage.tar' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
repacked rm audit-chains.tsv
refused 'In der Sicherung fehlt audit-chains.tsv' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
check 'Manifest: ein Teil ohne Prüfsumme und ein fehlender Teil werden abgelehnt'

# Packed again without a change it goes through, and the database is asked:
# what was turned away above was the change and not the packing.
repacked true
: > "$CALLS"
taken env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
grep -q '^pg_restore$' "$CALLS"
check 'Manifest: dasselbe Archiv, unverändert neu gepackt, wird zurückgespielt'

echo 'Sicherungen: alles in Ordnung.'
