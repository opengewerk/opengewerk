# The backup service. Built on the database image on purpose: pg_dump has to
# match the server it dumps, and taking the same image makes that automatic
# instead of a version somebody has to keep in sync.
#
# age comes on top, for encrypting an archive with a public key. The private
# key never touches this container, so a machine that makes backups cannot
# read its own older ones.
FROM postgres:18-alpine

# tzdata for the schedule, which runs at night in the time zone of the
# businesses and not in UTC (#130).
RUN apk add --no-cache age tzdata

COPY backup.sh restore.sh verify.sh schedule.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/verify.sh \
	/usr/local/bin/schedule.sh

# No entry point of its own. The service is called with the script it should
# run, which keeps backup and restore one image and two commands.
