# What restore.sh and verify.sh ask of an archive beyond its name (names.sh),
# before the database hears of it: where it comes from, and whether the heads
# of the audit chains in it are heads at all (opengewerk-haustechnik#360).
# Both read this file with "."; it is not run on its own.
#
# WHERE IT COMES FROM. The target is meant to be another machine, a NAS or a
# share, and whoever can write there can put an archive beside the others. A
# later time in its name makes it "latest", a manifest that fits its parts
# makes it whole, and encryption says nothing about who made it: the
# recipient is a public key and stands in the .env. So backup.sh writes the
# name and the SHA-256 of every archive it finishes into a record on the
# instance, archives.sha256 in BACKUP_STATUS_PATH, a volume only the backup
# services write and that never lies on the target. An archive that is not in
# it, or whose SHA-256 is another, was not written by this instance or not
# left as it was written, and is turned away. An installation that encrypts
# (BACKUP_AGE_RECIPIENT is set) also takes no archive in the clear, since none
# of its own is one.
#
# A new machine after a lost one has no record. --skip-origin-check takes the
# archive anyway, on the word of whoever types it, and docs/betrieb.md says when
# that is right. It is a flag on purpose and no setting: standing in the .env,
# it would switch the check off for good.

# Whether the archive copied from the target into $1, named $2 there, is one
# this instance wrote. $3 is "true" when --skip-origin-check was given. Says
# why not on stderr and returns 1. The caller reads the copy alone from here
# on, so that what is checked is what is read.
check_origin() {
	origin_name=$2

	if [ "$3" = true ]; then
		echo "  WARNUNG: Die Herkunft der Sicherung wird nicht geprüft (--skip-origin-check)."
		return 0
	fi

	case "$origin_name" in
	*.age) ;;
	*)
		if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
			echo "Die Sicherung ${origin_name} ist unverschlüsselt, diese Installation verschlüsselt" >&2
			echo "ihre Sicherungen aber (BACKUP_AGE_RECIPIENT ist gesetzt). Eine eigene ist das nicht." >&2
			return 1
		fi
		;;
	esac

	origin_record="${BACKUP_STATUS_PATH:-}/archives.sha256"

	if [ -z "${BACKUP_STATUS_PATH:-}" ] || [ ! -f "$origin_record" ]; then
		echo "Diese Instanz hat kein Verzeichnis der Sicherungen, die sie geschrieben hat" >&2
		echo "(archives.sha256 unter BACKUP_STATUS_PATH). Ob ${origin_name} von ihr stammt," >&2
		echo "lässt sich so nicht sagen." >&2
		return 1
	fi

	origin_expected=$(awk -v name="$origin_name" '$2 == name { hash = $1 } END { print hash }' "$origin_record")

	if [ -z "$origin_expected" ]; then
		echo "Die Sicherung ${origin_name} steht nicht im Verzeichnis der Sicherungen dieser" >&2
		echo "Instanz. Geschrieben hat sie eine andere." >&2
		return 1
	fi

	origin_actual=$(sha256sum "$1" | cut -d' ' -f1)

	if [ "$origin_actual" != "$origin_expected" ]; then
		echo "Die Sicherung ${origin_name} ist nicht mehr die, die diese Instanz geschrieben hat:" >&2
		echo "ihre Prüfsumme weicht vom Verzeichnis ab." >&2
		echo "  erwartet: ${origin_expected}" >&2
		echo "  gelesen:  ${origin_actual}" >&2
		return 1
	fi

	echo "  Herkunft geprüft: Die Sicherung steht im Verzeichnis dieser Instanz."
}

# The sentences after a refusal of check_origin, $1 says what is not done.
refuse_origin() {
	echo "Stammt sie sicher aus einer Sicherung dieser Anwendung, etwa auf einer neuen" >&2
	echo "Maschine ohne das Verzeichnis, nimmt sie ein Lauf mit --skip-origin-check (docs/betrieb.md," >&2
	echo "\"Zurückspielen\"). ${1}" >&2
	exit 1
}

# Whether every line of the file of chains in $1 holds a tenant and a number.
# Both go into statements of the superuser, the tenant as a text, so a line is
# held to what a chain can hold before it gets there: an archive taken with
# --skip-origin-check is one nobody here vouches for. Lines without a tenant
# are skipped here as they are where the file is read.
check_chains() {
	chains_tab=$(printf '\t')

	while IFS="$chains_tab" read -r chains_tenant chains_sequence chains_rest; do
		[ -n "$chains_tenant" ] || continue

		case "$chains_tenant" in
		*[!0-9a-f-]*) return 1 ;;
		esac

		[ "${#chains_tenant}" -eq 36 ] || return 1

		case "$chains_sequence" in
		'' | *[!0-9]*) return 1 ;;
		esac
	done <"$1"
}
