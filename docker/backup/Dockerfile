# The backup service. Built on the database image on purpose: pg_dump has to
# match the server it dumps, and taking the same image makes that automatic
# instead of a version somebody has to keep in sync.
#
# age comes on top, for encrypting an archive with a public key. The private
# key never touches this container, so a machine that makes backups cannot
# read its own older ones.
#
# By its digest (#687), the same one the database runs in compose.yaml;
# "test-stack.sh base-images" holds the two together when Dependabot moves
# them one after the other.
FROM postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873

# tzdata for the schedule, which runs at night in the time zone of the
# instance and not in UTC (#130).
RUN apk add --no-cache age tzdata

# names.sh is read by three of them and archive-checks.sh by two, and neither
# is run on its own, so they are not made executable.
COPY backup.sh restore.sh verify.sh schedule.sh names.sh archive-checks.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/verify.sh \
	/usr/local/bin/schedule.sh

# No entry point of its own. The service is called with the script it should
# run, which keeps backup and restore one image and two commands.
