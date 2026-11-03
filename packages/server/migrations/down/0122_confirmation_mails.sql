-- Takes back 0122 (#315). A confirmation that went out about an appointment
-- and a snippet for mails are records the business keeps: while there is one,
-- this rollback stops. The values of mail_kind, tenant_parameter_key and
-- snippet_purpose stay, PostgreSQL cannot take one back; a setting stored
-- under one of them stays too, and the version before does not read it.

DO $$
BEGIN
	ALTER TABLE mail_outbox NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE text_snippets NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM mail_outbox WHERE appointment_id IS NOT NULL OR kind IN ('appointment_confirmation', 'job_received'))
		OR EXISTS (SELECT 1 FROM text_snippets WHERE purpose = 'mail') THEN
		RAISE EXCEPTION 'Es gibt schon Bestätigungen per E-Mail oder Textbausteine für E-Mails. Die Rücknahme von 0122 würde sie löschen und bricht deshalb ab.';
	END IF;

	ALTER TABLE mail_outbox FORCE ROW LEVEL SECURITY;
	ALTER TABLE text_snippets FORCE ROW LEVEL SECURITY;
END
$$;

DROP INDEX "text_snippets_one_per_occasion";
ALTER TABLE "text_snippets" DROP COLUMN "mail_occasion";
DROP TYPE "public"."mail_occasion";
DROP INDEX "mail_outbox_appointment_idx";
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_appointment_in_tenant";
ALTER TABLE "mail_outbox" DROP COLUMN "appointment_id";
