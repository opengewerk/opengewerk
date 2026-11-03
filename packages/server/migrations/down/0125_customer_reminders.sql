-- Takes back 0125 (#316). The ground of a customer for reminders is a record
-- the business keeps, a consent above all, and a reminder that went out and
-- a snippet for it are records as well: while there is one, this rollback
-- stops. The values of mail_kind, tenant_parameter_key and mail_occasion
-- stay, PostgreSQL cannot take one back; the switch stored under one of them
-- stays too, and the version before does not read it.

DO $$
BEGIN
	ALTER TABLE customers NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE mail_outbox NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE text_snippets NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM customers WHERE reminder_ground IS NOT NULL)
		OR EXISTS (SELECT 1 FROM mail_outbox WHERE kind = 'customer_reminder')
		OR EXISTS (SELECT 1 FROM text_snippets WHERE mail_occasion = 'due_reminder') THEN
		RAISE EXCEPTION 'Es gibt schon Grundlagen für Erinnerungen an Kunden, verschickte Erinnerungen oder einen Text dafür. Die Rücknahme von 0125 würde sie löschen und bricht deshalb ab.';
	END IF;

	ALTER TABLE customers FORCE ROW LEVEL SECURITY;
	ALTER TABLE mail_outbox FORCE ROW LEVEL SECURITY;
	ALTER TABLE text_snippets FORCE ROW LEVEL SECURITY;
END
$$;

ALTER TABLE "customers" DROP CONSTRAINT "customers_reminder_ground_on";
ALTER TABLE "customers" DROP COLUMN "reminder_ground_on";
ALTER TABLE "customers" DROP COLUMN "reminder_ground";
DROP TYPE "public"."reminder_ground";
