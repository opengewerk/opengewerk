#!/bin/sh
# Makes a backup every night without anybody having to remember it (#130).
#
# Leitentscheidung 6 counts the backup as part of the product. A backup that
# runs when somebody thinks of it is missing on exactly the day it is needed,
# and the one that nobody ever watched turns out to be empty; the second half
# is answered by the office, which shows when the last one finished and warns
# when that is more than two days ago.
#
# Four things in here are decisions.
#
# 1. THE TIME IS A SETTING OF THE INSTANCE, 02:30 until its operators choose
#    another in their area (#188), in the time zone of the businesses. Not a
#    setting of a business: one instance can carry several, and the hour of
#    all of them is decided by the people who run the instance. It is read
#    again before every check, so a change arrives within five minutes and
#    without a restart, and a database that cannot be asked means 02:30.
#
# 2. IT CATCHES UP. A machine that is off at night makes its backup when it
#    comes back: a backup is due whenever the last one finished before the
#    most recent 02:30. A container restart in the afternoon, after the backup
#    of that night, therefore makes none.
#
# 3. ONE ATTEMPT PER NIGHT. A failure is written to the log, and a missing
#    backup turns up on the screen of the office after two days; trying again
#    every five minutes would fill the disk with half archives and the log
#    with the same sentence.
#
# 4. AN INSTANCE WITHOUT A BUSINESS IS NOT BACKED UP BY THE SCHEDULE. After a
#    lost disk the instance comes back empty, and a nightly backup of that
#    empty instance would be the newest archive, the one `restore.sh latest`
#    takes, and fourteen nights later the last one with data would be gone.
#    `backup.sh --scheduled` checks and skips; a backup by hand still does
#    whatever it is told.

set -eu

: "${BACKUP_STATUS_PATH:=/var/lib/opengewerk/backup-status}"

fallback='02:30'

# The time from the settings of the instance, "HH:MM", or the fallback when
# the database does not answer or answers with something that is not a time.
configured_time() {
	value=$(psql --host "$POSTGRES_HOST" --username postgres --dbname "$POSTGRES_DB" 		--tuples-only --no-align --quiet 		--command "select to_char(backup_time, 'HH24:MI') from instance_settings where id = 1" 		2>/dev/null || true)

	case "$value" in
		[0-2][0-9]:[0-5][0-9]) echo "$value" ;;
		*) echo "$fallback" ;;
	esac
}

# The epoch of the last backup that finished, or 0 when none is recorded.
last_recorded() {
	file="${BACKUP_STATUS_PATH}/last.json"

	if [ -f "$file" ]; then
		value=$(sed -n 's/.*"finishedEpoch": *\([0-9][0-9]*\).*/\1/p' "$file" | head -n 1)
		echo "${value:-0}"
	else
		echo 0
	fi
}

# The most recent moment a backup was due: today at $at once that has come,
# yesterday at $at before. On the two days a year the clock changes the day
# is an hour longer or shorter, and the moment moves by that hour, once.
latest_due() {
	now=$(date +%s)
	today=$(date -d "$(date +%Y-%m-%d) ${at}" +%s)

	if [ "$now" -ge "$today" ]; then
		echo "$today"
	else
		echo $((today - 86400))
	fi
}

at=$(configured_time)

echo "Geplante Sicherung: jeden Tag um ${at} Uhr (${TZ:-UTC}), und nachgeholt, wenn die letzte vor dem letzten Termin lag."

attempted=0

while true; do
	wanted=$(configured_time)

	if [ "$wanted" != "$at" ]; then
		at=$wanted
		echo "Die Uhrzeit der geplanten Sicherung ist jetzt ${at} Uhr (${TZ:-UTC})."
	fi

	due=$(latest_due)
	last=$(last_recorded)

	if [ "$last" -lt "$due" ] && [ "$attempted" -lt "$due" ]; then
		attempted=$due

		if ! backup.sh --scheduled; then
			echo "Die geplante Sicherung ist fehlgeschlagen, der nächste Versuch folgt zum nächsten Termin." >&2
		fi
	fi

	sleep 300
done
