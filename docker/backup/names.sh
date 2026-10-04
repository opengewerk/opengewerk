# The names of the archives, in one place for the three scripts that look
# for them: backup.sh, restore.sh and verify.sh read this file with "."
# (opengewerk-haustechnik#14). It is not run on its own.
#
# An archive is named after the database it holds, "<database>-<time>.tar.gz",
# unless BACKUP_PREFIX names it otherwise. Two applications that keep their
# backups in one place therefore keep them apart without anybody having to
# remember it: each finds, keeps, restores and removes only its own, and
# "latest" is the newest of its own. The image stays the same for every
# application, which is the point.
#
# The pattern ends in the shape of the time, on purpose. A bare "<prefix>-*"
# would also take the archives of an application whose prefix begins with this
# one's and a hyphen, and the retention in backup.sh would delete them.

: "${BACKUP_PREFIX:=${POSTGRES_DB:-opengewerk}}"

case "$BACKUP_PREFIX" in
'' | *[!A-Za-z0-9_-]*)
	echo "BACKUP_PREFIX \"${BACKUP_PREFIX}\" taugt nicht als Anfang eines Dateinamens: erlaubt sind" >&2
	echo "Buchstaben, Ziffern, Unterstriche und Bindestriche." >&2
	exit 1
	;;
esac

# The time as backup.sh writes it, date -u +%Y-%m-%dT%H%M%SZ.
digit='[0-9]'
archives="${BACKUP_PREFIX}-${digit}${digit}${digit}${digit}-${digit}${digit}-${digit}${digit}T${digit}${digit}${digit}${digit}${digit}${digit}Z.tar.gz*"

# Whether a file is an archive of this application, going by its name.
#
# "latest" finds its archive through the pattern above and so cannot leave the
# archives of this application. An archive somebody names has to pass the same
# question: in a place two applications share, the name of the other one's
# archive is one slip of the hand away, both keep their tenants in tables of
# the same names, and a restore would put the tenants of one application into
# the database of the other (opengewerk-haustechnik#31).
is_own_archive() {
	# Not quoted on purpose: only unquoted does case read it as a pattern.
	# shellcheck disable=SC2254
	case "$(basename "$1")" in
	$archives) return 0 ;;
	esac

	return 1
}
