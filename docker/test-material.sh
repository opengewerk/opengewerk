# What the checks of a running stack in test-stack.sh need to know about this
# application and can read nowhere else (opengewerk-haustechnik#14). Read
# with "." once the helpers there are defined, so the functions below may use
# sql, value, store_file and compose, and the two tenants test-stack.sh
# creates are $first_tenant and $second_tenant.

# A route touching data, which refuses everybody without a sign in.
guarded_route=/customers

# What a backup has to bring back besides the tenants, the audit log and the
# file store, which every application has: the tables counted before the
# backup and after the restore.
counted_tables='customers attachment_versions'

# The migrations, and how many of them make the older state an update starts
# from. Four leaves the two that follow as the ones that have to carry data
# over.
migrations="$here/../packages/server/migrations"
older_migrations=4

# What the update from that state adds to the log of a tenant that was there
# before, as "<table> (<reason>)": migration 0063 gives every business its
# roles as rows, and those are changes like any other.
update_adds='tenant_roles (migration)'

# A customer for each business, and a file in the records (#77) with the rows
# that make it one: the file of the business, an attachment at its customer
# and the version that names the file.
records_for_backup() {
  sql "
    insert into customers (tenant_id, kind, name) values
      ('$first_tenant', 'business', 'Bauherr Nord'),
      ('$second_tenant', 'business', 'Bauherr Süd');"

  hash=$(store_file 'Aufmass Keller')
  sql "
    insert into files (tenant_id, sha256, size_bytes, media_type) values
      ('$first_tenant', '$hash', 14, 'text/plain');
    insert into attachments (id, tenant_id, customer_id, title)
      select '01931c00-0000-7000-8000-0000000000a1', tenant_id, id, 'Aufmass'
        from customers where name = 'Bauherr Nord';
    insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes) values
      ('$first_tenant', '01931c00-0000-7000-8000-0000000000a1', '$hash', 'Aufmass.txt', 'text/plain', 14);"
}

# Two customers of one business, on the older state, which has no files yet.
records_for_update() {
  sql "
    insert into customers (tenant_id, kind, name) values
      ('$first_tenant', 'business', 'Bauherr Nord'),
      ('$first_tenant', 'private', 'Familie Weber');"
}

# The file the records name is back where the store looks for it, with the
# contents its name promises (#77).
after_restore() {
  hash=$(value 'select sha256 from attachment_versions')
  found=$(compose exec -T app sh -c 'sha256sum "$STORAGE_PATH/$(printf "%s" "$1" | cut -c1-2)/$(printf "%s" "$1" | cut -c3-4)/$1"' sh "$hash" | cut -d' ' -f1)
  test "${found}" = "${hash}"
  echo 'Die abgelegte Datei ist mit ihrer Fassung zurück.'
}

# The customers from before the update, and on them one of the columns the
# update hangs on every table that holds records. On rows that were there
# already it has to carry its default, otherwise the migration would have
# stopped.
after_update() {
  test "$(value 'select count(*) from customers')" = 2
  test "$(value 'select count(*) from customers where change_sequence is null')" = 0
  echo 'Die Kunden von vor dem Update sind da, jeder mit seiner Änderungsnummer.'
}
