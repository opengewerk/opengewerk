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
# (opengewerk-haustechnik#31), an archive this instance did not write or that
# is in the clear where the installation encrypts, and a file of chains that
# holds something other than chains (opengewerk-haustechnik#360). And how a
# backup reaches the target: encrypted in one stream, never in the clear, and
# when anything fails on the way not at all. Whether a whole instance comes
# back out of an archive is the job of the CI run that backs one up and
# restores it.
#
# Runs in the image of the backup, with its shell, its tar and a real age:
#
#   docker build --tag opengewerk-backup-under-test backup
#   docker run --rm --volume "$PWD:/docker:ro" opengewerk-backup-under-test sh /docker/test-backup.sh
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

source_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

real_age=$(command -v age) || {
  echo 'FEHLER: age fehlt. test-backup.sh läuft im Abbild der Sicherung, siehe oben.'
  exit 1
}
real_tar=$(command -v tar)
real_date=$(command -v date)
real_cp=$(command -v cp)

mkdir -p "$work/bin" "$work/storage" "$work/backups" "$work/status" "$work/tmp"
cp "$source_dir/backup/backup.sh" "$source_dir/backup/restore.sh" \
  "$source_dir/backup/verify.sh" "$source_dir/backup/names.sh" \
  "$source_dir/backup/archive-checks.sh" "$work/bin/"

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
# included. pg_restore writes down whom it signs in as, with the password.
cat > "$work/bin/psql" <<'FAKE'
#!/bin/sh
printf 'psql %s\n' "$*" >> "$CALLS"
case "$*" in
  *server_version*) echo 18 ;;
esac
FAKE
cat > "$work/bin/pg_restore" <<'FAKE'
#!/bin/sh
printf 'pg_restore %s password=%s\n' "$*" "${PGPASSWORD:-}" >> "$CALLS"
FAKE
#
# age as it is, unless a check asks otherwise: AGE_SAW names a file to write
# down what lies on the target while it encrypts, AGE_FAILS=halfway passes on
# a little of what it reads and fails. SWAP_FROM and SWAP_ONTO replace a file
# on the target with another before it decrypts, the way somebody who writes
# there could between the check of an archive and its reading; tar does the
# same before it unpacks.
cat > "$work/bin/age" <<FAKE
#!/bin/sh
if [ -n "\${SWAP_FROM:-}" ] && [ "\$1" = --decrypt ]; then
  cp "\$SWAP_FROM" "\$SWAP_ONTO"
fi
if [ -n "\${AGE_SAW:-}" ]; then
  ls -A "\$BACKUP_PATH" > "\$AGE_SAW"
  find "\$TMPDIR" -type f -exec stat -c %a {} + | sort -u > "\$AGE_SAW.parts"
fi
if [ "\${AGE_FAILS:-}" = halfway ]; then
  head -c 100
  exit 1
fi
exec $real_age "\$@"
FAKE
#
# tar as it is, unless TAR_FAILS is set: then the archive it writes into a
# pipe breaks off after a little, the way a disk error would end it.
cat > "$work/bin/tar" <<FAKE
#!/bin/sh
if [ -n "\${SWAP_FROM:-}" ] && [ "\$1" = --extract ]; then
  cp "\$SWAP_FROM" "\$SWAP_ONTO"
fi
if [ -n "\${TAR_FAILS:-}" ] && [ "\$1" = --create ]; then
  case " \$* " in
    *' --file - '*)
      $real_tar "\$@" | head -c 200
      exit 1
      ;;
  esac
fi
exec $real_tar "\$@"
FAKE
#
# date as it is, unless FIXED_STAMP is set: then the time backup.sh names an
# archive after is that one, as for two backups in the same second.
cat > "$work/bin/date" <<FAKE
#!/bin/sh
if [ -n "\${FIXED_STAMP:-}" ] && [ "\$*" = '-u +%Y-%m-%dT%H%M%SZ' ]; then
  echo "\$FIXED_STAMP"
  exit 0
fi
exec $real_date "\$@"
FAKE
#
# cp as it is, unless CP_SERVES is set: then a copy of CP_FROM gets what
# CP_SERVES holds, as if the target held another file at the moment it is
# copied and the archive again right after.
cat > "$work/bin/cp" <<FAKE
#!/bin/sh
if [ -n "\${CP_SERVES:-}" ] && [ "\$1" = "\${CP_FROM:-}" ]; then
  exec $real_cp "\$CP_SERVES" "\$2"
fi
exec $real_cp "\$@"
FAKE
chmod +x "$work/bin/pg_dump" "$work/bin/psql" "$work/bin/pg_restore" "$work/bin/age" "$work/bin/tar" \
  "$work/bin/date" "$work/bin/cp"

PATH="$work/bin:$PATH"
PGPASSWORD=probe
OPENGEWERK_OWNER_PASSWORD=owner-probe
STORAGE_PATH="$work/storage"
BACKUP_PATH="$work/backups"
BACKUP_STATUS_PATH="$work/status"
TMPDIR="$work/tmp"
CALLS="$work/calls"
export PATH PGPASSWORD OPENGEWERK_OWNER_PASSWORD STORAGE_PATH BACKUP_PATH BACKUP_STATUS_PATH TMPDIR CALLS

# A key pair for the archives that are encrypted here.
"$real_age-keygen" -o "$work/key.txt" 2> /dev/null
recipient=$("$real_age-keygen" -y "$work/key.txt")

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
  : > "$CALLS"

  if ! "$@" > "$work/out" 2>&1; then
    printf 'FEHLER: abgelehnt: %s\n' "$*"
    cat "$work/out"
    exit 1
  fi
}

# Two older archives of this application, two of another whose prefix begins
# with this one's and a hyphen, and a file that only looks like an archive.
# Sorted by name, every one of the others comes after the newest of this one.
# None of them was written by a backup, so none stands in the record.
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

# Its own it takes, by name and by path. The encrypted one was never written
# by a backup and stops at the record; with --skip-origin-check it gets as far
# as the question for the key, which this run has none of: its name did not
# stop it.
taken env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
grep -qx "Sicherung: $ours" "$work/out"
taken env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" "$work/backups/$ours"
grep -qx "Sicherung: $ours" "$work/out"
taken env BACKUP_PREFIX=opengewerk-haustechnik POSTGRES_DB=haustechnik sh "$work/bin/restore.sh" "$mine"
grep -qx "Sicherung: $mine" "$work/out"
refused 'steht nicht im Verzeichnis' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$old"
refused 'BACKUP_AGE_IDENTITY' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" --skip-origin-check "$old"
grep -qx "Sicherung: $old" "$work/out"
check 'mit Namen genannt: das eigene Archiv wird genommen'

# 6. An archive that unpacks cleanly and does not hold what its manifest says.
# A changed byte in the packed file would not get as far as the manifest: gzip
# carries a checksum of its own, and an encrypted archive is authenticated by
# age. What only the manifest can notice is a part that is not the part the
# backup wrote, inside packing that is whole. So each one is unpacked, changed
# and packed again here, and turned away before anything is asked of the
# database. A repacked archive is no longer the one in the record, which turns
# it away first; the manifest is what stands behind the record on a new
# machine, so it is asked with --skip-origin-check.
pristine="$work/pristine.tar.gz"
cp "$work/backups/$ours" "$pristine"

# Unpacks the archive as the backup wrote it, runs the change on its parts
# and packs it again under the name in $target, its own unless set.
repacked() {
  rm -rf "$work/unpacked"
  mkdir "$work/unpacked"
  tar --extract --gzip --file "$pristine" --directory "$work/unpacked"
  (cd "$work/unpacked" && "$@")
  tar --create --gzip --file "$work/backups/${target:-$ours}" --directory "$work/unpacked" .
}

one_byte_more() {
  printf 'x' >> "$1"
}

without_its_checksum() {
  grep -v "\"$1\"" manifest.json > manifest.new
  mv manifest.new manifest.json
}

repacked one_byte_more database.dump
refused 'weicht vom Verzeichnis ab' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
refused 'weicht vom Verzeichnis ab' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" latest
refused 'weicht vom Verzeichnis ab' env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" "$ours"
check 'Verzeichnis: ein verändertes Archiv ist nicht mehr das geschriebene, die Datenbank nicht gefragt'

for part in database.dump storage.tar audit-chains.tsv; do
  repacked one_byte_more "$part"
  refused "Die Prüfsumme von $part stimmt nicht" env POSTGRES_DB=opengewerk \
    sh "$work/bin/restore.sh" --skip-origin-check "$ours"
  refused "Die Prüfsumme von $part stimmt nicht" env POSTGRES_DB=opengewerk \
    sh "$work/bin/restore.sh" --skip-origin-check latest
done
check 'Manifest: ein veränderter Teil in einem heilen Archiv wird abgelehnt, die Datenbank nicht gefragt'

repacked without_its_checksum storage.tar
refused 'Im Manifest steht keine Prüfsumme für storage.tar' env POSTGRES_DB=opengewerk \
  sh "$work/bin/restore.sh" --skip-origin-check "$ours"
repacked rm audit-chains.tsv
refused 'In der Sicherung fehlt audit-chains.tsv' env POSTGRES_DB=opengewerk \
  sh "$work/bin/restore.sh" --skip-origin-check "$ours"
check 'Manifest: ein Teil ohne Prüfsumme und ein fehlender Teil werden abgelehnt'

# Packed again without a change it goes through, and the database is asked:
# what was turned away above was the change and not the packing.
repacked true
taken env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" --skip-origin-check "$ours"
grep -q '^pg_restore ' "$CALLS"
grep -q 'WARNUNG: Die Herkunft der Sicherung wird nicht geprüft' "$work/out"
check 'Manifest: dasselbe Archiv, unverändert neu gepackt, wird mit --skip-origin-check zurückgespielt'

# Back to what the backup wrote, for the checks below.
cp "$pristine" "$work/backups/$ours"

# 7. Where an archive comes from (opengewerk-haustechnik#360). Whoever can write
# to the target can put an archive there with a later time in its name, whole
# and with a manifest that fits, and encrypted too: the recipient is a public
# key. "latest" finds it, and the record turns it away before it is unpacked
# or decrypted.
planted='opengewerk-2099-01-01T000000Z.tar.gz'
target=$planted
repacked true
target=''
refused 'steht nicht im Verzeichnis' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" latest
grep -qx "Sicherung: $planted" "$work/out"
refused 'steht nicht im Verzeichnis' env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" latest
grep -qx "Sicherung: $planted" "$work/out"

planted_encrypted='opengewerk-2099-01-02T000000Z.tar.gz.age'
"$real_age" --recipient "$recipient" --output "$work/backups/$planted_encrypted" "$work/backups/$planted"
refused 'steht nicht im Verzeichnis' env POSTGRES_DB=opengewerk BACKUP_AGE_RECIPIENT="$recipient" \
  BACKUP_AGE_IDENTITY="$work/key.txt" sh "$work/bin/restore.sh" latest
grep -qx "Sicherung: $planted_encrypted" "$work/out"
if grep -q 'entschlüsselt' "$work/out"; then
  echo 'FEHLER: die untergeschobene Sicherung wurde entschlüsselt'
  exit 1
fi
rm -f "$work/backups/$planted" "$work/backups/$planted_encrypted"
check 'Herkunft: eine untergeschobene Sicherung mit späterem Datum wird abgelehnt, verschlüsselt oder nicht'

# An installation that encrypts takes no archive in the clear, even one of its
# own from before it encrypted.
refused 'ist unverschlüsselt, diese Installation verschlüsselt' env POSTGRES_DB=opengewerk \
  BACKUP_AGE_RECIPIENT="$recipient" sh "$work/bin/restore.sh" "$ours"
refused 'ist unverschlüsselt, diese Installation verschlüsselt' env POSTGRES_DB=opengewerk \
  BACKUP_AGE_RECIPIENT="$recipient" sh "$work/bin/verify.sh" "$ours"
taken env POSTGRES_DB=opengewerk BACKUP_AGE_RECIPIENT="$recipient" \
  sh "$work/bin/restore.sh" --skip-origin-check "$ours"
grep -q '^pg_restore ' "$CALLS"
check 'Herkunft: Klartext wird abgelehnt, wenn die Installation verschlüsselt'

# A new machine after a lost one has no record. Without the flag nothing is
# restored, with it the archive is, and the checks behind it still run.
mkdir -p "$work/new-machine"
refused 'kein Verzeichnis der Sicherungen' env POSTGRES_DB=opengewerk \
  BACKUP_STATUS_PATH="$work/new-machine" sh "$work/bin/restore.sh" latest
refused 'kein Verzeichnis der Sicherungen' env -u BACKUP_STATUS_PATH POSTGRES_DB=opengewerk \
  sh "$work/bin/restore.sh" "$ours"
refused 'kein Verzeichnis der Sicherungen' env POSTGRES_DB=opengewerk \
  BACKUP_STATUS_PATH="$work/new-machine" sh "$work/bin/verify.sh" latest
taken env POSTGRES_DB=opengewerk BACKUP_STATUS_PATH="$work/new-machine" \
  sh "$work/bin/restore.sh" --skip-origin-check latest
grep -qx "Sicherung: $ours" "$work/out"
grep -q '^pg_restore ' "$CALLS"
check 'Herkunft: auf einer neuen Maschine ohne Verzeichnis nur mit --skip-origin-check'

# 8. The dump is restored by the owner of the tables, with its own password,
# and not by the superuser under SET ROLE, which a statement in the dump could
# take back.
taken env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" "$ours"
grep '^pg_restore ' "$CALLS" > "$work/restored"
grep -q -- '--username opengewerk_owner ' "$work/restored"
grep -q ' password=owner-probe$' "$work/restored"
if grep -q -e '--role' -e '--username postgres' -e 'password=probe$' "$work/restored"; then
  echo 'FEHLER: pg_restore lief als Superuser'
  cat "$work/restored"
  exit 1
fi
refused 'OPENGEWERK_OWNER_PASSWORD fehlt' env -u OPENGEWERK_OWNER_PASSWORD POSTGRES_DB=opengewerk \
  sh "$work/bin/restore.sh" "$ours"
check 'Rückspielen: pg_restore als Eigentümer der Tabellen, nicht als Superuser'

# 9. The heads of the chains go into statements of the superuser after the
# restore, and into those of verify.sh. A line that is no head is turned away
# before, also from an archive taken on the word of whoever types the flag.
# The manifest is made to fit, so that it is the line that is turned away.
with_chains() {
  printf '%s\n' "$1" > audit-chains.tsv
  sum=$(sha256sum audit-chains.tsv | cut -d' ' -f1)
  sed -i "s/\"audit-chains.tsv\": \"[0-9a-f]*\"/\"audit-chains.tsv\": \"$sum\"/" manifest.json
}

tab=$(printf '\t')
tenant='01931c00-0000-7000-8000-000000000001'
# A statement as long as a UUID, a UUID cut short, a number with a statement
# behind it, and no number.
statement="x'; select 1; --$(printf '%020d' 0 | tr 0 a)"
for line in "${statement}${tab}1${tab}" "${tenant%-*}${tab}1${tab}" \
  "${tenant}${tab}1; select 1${tab}" "${tenant}${tab}${tab}"; do
  repacked with_chains "$line"
  refused 'kein Kopf einer Kette' env POSTGRES_DB=opengewerk sh "$work/bin/restore.sh" --skip-origin-check "$ours"
  refused 'kein Kopf einer Kette' env POSTGRES_DB=opengewerk sh "$work/bin/verify.sh" --skip-origin-check "$ours"
done
# A line that is a head gets through to the query. The stand-in of psql knows
# no chain, so the comparison after it fails, and says so.
repacked with_chains "${tenant}${tab}7${tab}$(printf '%064d' 0 | tr 0 a)"
for script in restore.sh verify.sh; do
  : > "$CALLS"
  if env POSTGRES_DB=opengewerk sh "$work/bin/$script" --skip-origin-check "$ours" > "$work/out" 2>&1; then
    printf 'FEHLER: %s lief gegen eine Kette durch, die die Datenbank nicht kennt\n' "$script"
    exit 1
  fi
  grep -q -e 'die Kette weicht von der Sicherung ab' -e 'Eintrag 6 fehlt heute' "$work/out"
  grep -q "tenant_id = '${tenant}'" "$CALLS"
done
cp "$pristine" "$work/backups/$ours"
check 'Audit-Ketten: eine Zeile, die kein Kopf ist, wird abgelehnt, bevor sie in eine Abfrage geht'

# 10. How a backup reaches the target (opengewerk-haustechnik#360). Under a
# prefix of its own, so that "latest" of the checks above stays where it was.
# What lay on the target while age encrypted is written down by the stand-in:
# the archives from before and the hidden file it encrypts into, never a
# packed archive or a dump in the clear. And the parts in the container, which
# are readable by their owner alone.
export BACKUP_PREFIX=streamed
ls -A "$work/backups" > "$work/before"
cp "$work/status/archives.sha256" "$work/record-before"

POSTGRES_DB=opengewerk BACKUP_KEEP=0 BACKUP_AGE_RECIPIENT="$recipient" AGE_SAW="$work/saw" \
  sh "$work/bin/backup.sh" > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
streamed=$(sed -n 's|^Fertig: .*/\([^/ ]*\) (.*|\1|p' "$work/out")
printf '%s' "$streamed" | grep -Eq '^streamed-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gz\.age$'
grep -vxF -f "$work/before" "$work/saw" > "$work/new" || true
if [ "$(wc -l < "$work/new")" -ne 1 ] ||
  ! grep -Eqx "\.${streamed%.tar.gz.age}\.[A-Za-z0-9]{6}" "$work/new"; then
  echo 'FEHLER: während age lief, lag auf dem Ziel mehr als die verborgene Datei:'
  cat "$work/new"
  exit 1
fi
ls -A "$work/backups" | grep -vxF -f "$work/before" > "$work/new" || true
test "$(cat "$work/new")" = "$streamed"
test "$(stat -c %a "$work/backups/$streamed")" = 600
test "$(stat -c %a "$work/backups/$named")" = 600
test "$(cat "$work/saw.parts")" = 600
test -z "$(ls -A "$work/tmp")"
check 'Strom: auf dem Ziel liegt nur die verschlüsselte Datei, nur für ihren Besitzer lesbar, die Teile sind weg'

# What the record holds: the archive with its SHA-256, a line more than before,
# and the same in last.json, which stays readable for the application.
hash=$(sha256sum "$work/backups/$streamed" | cut -d' ' -f1)
grep -vxF -f "$work/record-before" "$work/status/archives.sha256" > "$work/new"
test "$(cat "$work/new")" = "$hash  $streamed"
grep -q "\"sha256\": \"$hash\"" "$work/status/last.json"
grep -q "\"archive\": \"$streamed\"" "$work/status/last.json"
grep -q '"encrypted": true' "$work/status/last.json"
test "$(stat -c %a "$work/status/last.json")" = 644
"$real_age" --decrypt --identity "$work/key.txt" "$work/backups/$streamed" | "$real_tar" -tzf - | grep -qx './manifest.json'
taken env POSTGRES_DB=opengewerk BACKUP_AGE_RECIPIENT="$recipient" BACKUP_AGE_IDENTITY="$work/key.txt" \
  sh "$work/bin/restore.sh" latest
grep -qx "Sicherung: $streamed" "$work/out"
grep -q '^pg_restore ' "$CALLS"
check 'Verzeichnis: Name und Prüfsumme der Sicherung auf der Instanz, das Rückspielen nimmt sie'

# What is checked is what is read: the archive is copied from the target once,
# and replaced there after the check, before age or tar read it, the restore
# and the check of the chains still read the archive that was checked. An
# encrypted one and one in the clear, because they are read by different
# tools.
printf 'kein Archiv' > "$work/swap"
cp "$work/backups/$streamed" "$work/kept"
for script in restore.sh verify.sh; do
  taken env POSTGRES_DB=opengewerk BACKUP_AGE_RECIPIENT="$recipient" BACKUP_AGE_IDENTITY="$work/key.txt" \
    SWAP_FROM="$work/swap" SWAP_ONTO="$work/backups/$streamed" sh "$work/bin/$script" latest
  cmp -s "$work/swap" "$work/backups/$streamed"
  [ "$script" = verify.sh ] || grep -q '^pg_restore ' "$CALLS"
  cp "$work/kept" "$work/backups/$streamed"
done
for script in restore.sh verify.sh; do
  taken env BACKUP_PREFIX=opengewerk POSTGRES_DB=opengewerk \
    SWAP_FROM="$work/swap" SWAP_ONTO="$work/backups/$ours" sh "$work/bin/$script" "$ours"
  cmp -s "$work/swap" "$work/backups/$ours"
  [ "$script" = verify.sh ] || grep -q '^pg_restore ' "$CALLS"
  cp "$pristine" "$work/backups/$ours"
done

# And the checksum is the one of the copy: when the target held another file
# at the moment it was copied, the copy is turned away, though the archive is
# back on the target by the time anybody looks.
for script in restore.sh verify.sh; do
  refused 'weicht vom Verzeichnis ab' env POSTGRES_DB=opengewerk BACKUP_AGE_RECIPIENT="$recipient" \
    BACKUP_AGE_IDENTITY="$work/key.txt" CP_SERVES="$work/swap" CP_FROM="$work/backups/$streamed" \
    sh "$work/bin/$script" latest
done
check 'Herkunft: geprüft und gelesen wird dieselbe Kopie, ein danach getauschtes Archiv bleibt ungelesen'

# Two backups that finish at the same moment both keep their line: the record
# is rewritten under a lock. The lock is held here while a line is added the
# same way, read before the backup runs and written after it would have.
(
  flock 9
  cp "$work/status/archives.sha256" "$work/held"
  sleep 2
  printf '%064d  %s\n' 0 'held-2026-01-01T000000Z.tar.gz' >> "$work/held"
  mv "$work/held" "$work/status/archives.sha256"
) 9> "$work/status/.lock" &
holder=$!
sleep 1
BACKUP_PREFIX=locked POSTGRES_DB=opengewerk BACKUP_KEEP=0 sh "$work/bin/backup.sh" > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
wait "$holder"
locked=$(sed -n 's|^Fertig: .*/\([^/ ]*\) (.*|\1|p' "$work/out")
grep -q '  held-2026-01-01T000000Z.tar.gz$' "$work/status/archives.sha256"
grep -q "  ${locked}\$" "$work/status/archives.sha256"
check 'Verzeichnis: zwei Sicherungen zugleich behalten beide ihre Zeile'

# A backup that fails on the way leaves nothing on the target and no record:
# age that breaks off after a little, age that refuses the recipient, a tar
# that breaks off while age carries on, which only pipefail notices, and a
# record that cannot be written once the archive is whole and has its name,
# which takes the archive with it. Under a prefix of their own: in the second
# of the backup above, a name of its own would already be taken.
export BACKUP_PREFIX=failing
ls -A "$work/backups" > "$work/before"
cp "$work/status/archives.sha256" "$work/record-before"
cp "$work/status/last.json" "$work/last-before"

failed_backup() {
  if env POSTGRES_DB=opengewerk BACKUP_KEEP=0 "$@" sh "$work/bin/backup.sh" > "$work/out" 2>&1; then
    printf 'FEHLER: die Sicherung lief durch: %s\n' "$*"
    cat "$work/out"
    exit 1
  fi

  ls -A "$work/backups" > "$work/after"

  if ! cmp -s "$work/before" "$work/after"; then
    printf 'FEHLER: nach einer gescheiterten Sicherung liegt etwas auf dem Ziel: %s\n' "$*"
    grep -vxF -f "$work/before" "$work/after" || true
    exit 1
  fi

  if ! cmp -s "$work/record-before" "$work/status/archives.sha256" ||
    ! cmp -s "$work/last-before" "$work/status/last.json"; then
    printf 'FEHLER: eine gescheiterte Sicherung steht im Verzeichnis: %s\n' "$*"
    exit 1
  fi

  test -z "$(ls -A "$work/tmp")"
}

failed_backup BACKUP_AGE_RECIPIENT="$recipient" AGE_FAILS=halfway
failed_backup BACKUP_AGE_RECIPIENT=age1nothing
failed_backup BACKUP_AGE_RECIPIENT="$recipient" TAR_FAILS=1
: > "$work/no-folder"
failed_backup BACKUP_AGE_RECIPIENT="$recipient" BACKUP_STATUS_PATH="$work/no-folder"
check 'Strom: scheitert age oder tar, bleibt auf dem Ziel nichts liegen und nichts im Verzeichnis'

# A second backup in the same second would take the name of the first. It
# stops before that, and when it fails, the first stays as it was.
POSTGRES_DB=opengewerk BACKUP_KEEP=0 FIXED_STAMP=2026-05-05T000000Z sh "$work/bin/backup.sh" > "$work/out" 2>&1 || {
  cat "$work/out"
  exit 1
}
first="$work/backups/failing-2026-05-05T000000Z.tar.gz"
sum=$(sha256sum "$first")

if POSTGRES_DB=opengewerk BACKUP_KEEP=0 FIXED_STAMP=2026-05-05T000000Z BACKUP_STATUS_PATH="$work/no-folder" \
  sh "$work/bin/backup.sh" > "$work/out" 2>&1; then
  echo 'FEHLER: eine zweite Sicherung in derselben Sekunde lief durch'
  exit 1
fi

grep -q 'liegt schon eine Sicherung' "$work/out"
test "$(sha256sum "$first")" = "$sum"
check 'Strom: eine zweite Sicherung in derselben Sekunde lässt die erste, wie sie war'

echo 'Sicherungen: alles in Ordnung.'
