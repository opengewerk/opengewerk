#!/bin/sh
# Exercises the names of the archives (opengewerk-haustechnik#14) with the
# backup scripts themselves and stand-ins for the tools of PostgreSQL: an
# archive is named after its database unless BACKUP_PREFIX says otherwise, the
# retention removes only archives of its own prefix, and "latest" is the newest
# of its own. All of it in one folder with the archives of another application
# whose prefix begins with this one's, the case a bare "<prefix>-*" gets wrong.
# What an archive holds and whether it comes back is the job of the CI run
# that backs up and restores a whole instance.
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
cat > "$work/bin/psql" <<'FAKE'
#!/bin/sh
case "$*" in
  *server_version*) echo 18 ;;
esac
FAKE
cat > "$work/bin/pg_restore" <<'FAKE'
#!/bin/sh
FAKE
chmod +x "$work/bin/pg_dump" "$work/bin/psql" "$work/bin/pg_restore"

PATH="$work/bin:$PATH"
PGPASSWORD=probe
STORAGE_PATH="$work/storage"
BACKUP_PATH="$work/backups"
export PATH PGPASSWORD STORAGE_PATH BACKUP_PATH

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

echo 'Namen der Sicherungen: alles in Ordnung.'
