-- Takes back 0133 (#318). A request for access is a record that somebody asked
-- and was answered: this rollback deletes none. While there is one, it stops.
-- Which they are, this shows:
--
--   select id, subject, received_on, status from access_requests;
--
-- The right `privacy.access` leaves every role that has it.

DO $$
BEGIN
	ALTER TABLE "access_requests" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "access_requests") THEN
		RAISE EXCEPTION 'Es gibt schon Auskunftsanfragen. Die Rücknahme von 0133 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "access_requests" FORCE ROW LEVEL SECURITY;
END
$$;

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;
SELECT set_config('app.reason', 'migration', true);
UPDATE "tenant_roles" SET "rights" = array_remove("rights", 'privacy.access')
 WHERE 'privacy.access' = ANY ("rights");
SELECT set_config('app.reason', '', true);
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;

DROP TABLE "access_requests";
DROP FUNCTION "access_request_moves_on"();
DROP FUNCTION "access_request_contact_in_tenant"();
DROP TYPE "public"."access_request_status";
DROP TYPE "public"."access_request_channel";
DROP TYPE "public"."personal_subject";
