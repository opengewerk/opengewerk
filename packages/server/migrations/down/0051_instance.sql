-- Takes back 0051. Played in as the superuser, like every rollback: the
-- functions and tables go, and with them the log of the instance.

DROP FUNCTION IF EXISTS "instance_tenants"();
DROP FUNCTION IF EXISTS "create_tenant"(text);
DROP POLICY IF EXISTS "readable_by_the_owner" ON "memberships";
DROP TRIGGER IF EXISTS "instance_changes" ON "tenants";
DROP TABLE IF EXISTS "instance_changes";
DROP TABLE IF EXISTS "instance_settings";
DROP TABLE IF EXISTS "instance_operators";
DROP FUNCTION IF EXISTS "record_instance_change"();
DROP FUNCTION IF EXISTS "instance_change_stays"();
