-- Rollback of 0120_service_calls.sql. Refused while a request for an early
-- start or a message with the instructions of a service call exists: those are
-- what was shown to and sent to a customer, and a rollback does not throw them
-- away. The value of mail_kind stays, PostgreSQL cannot take one back.

DO $$
BEGIN
	ALTER TABLE early_start_requests NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE mail_outbox NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM early_start_requests)
		OR EXISTS (SELECT 1 FROM mail_outbox WHERE job_id IS NOT NULL OR early_start_request_id IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt schon unterschriebene Verlangen auf vorzeitigen Beginn oder verschickte Belehrungen zu Serviceeinsätzen. Die Rücknahme von 0120 würde sie löschen und bricht deshalb ab.';
	END IF;

	ALTER TABLE mail_outbox FORCE ROW LEVEL SECURITY;
END
$$;

ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_early_start_request_in_tenant";
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_job_in_tenant";
DROP INDEX "mail_outbox_early_start_request_idx";
DROP INDEX "mail_outbox_job_idx";
ALTER TABLE "mail_outbox" DROP COLUMN "early_start_request_id";
ALTER TABLE "mail_outbox" DROP COLUMN "job_id";
DROP TABLE "early_start_requests";
DROP FUNCTION "early_start_for_service_call"();
ALTER TABLE "jobs" DROP COLUMN "urgent_repair";
