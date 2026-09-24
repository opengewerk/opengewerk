-- Rolling filled forms back to how 0042 left them.
--
-- What it costs an installation that runs it: every protocol, which is a
-- record of a test that was done. The rollback therefore stops while there is
-- a single one. The four units stay in the enum of the rule engine; a value
-- cannot be taken out of an enum, and an unused one does no harm.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "form_records") THEN
		RAISE EXCEPTION 'Es gibt Prüfprotokolle. Sie halten fest, was geprüft wurde; die Rücknahme bricht ab, damit sie nicht verloren gehen.';
	END IF;
END
$$;--> statement-breakpoint
DROP TABLE "form_records";--> statement-breakpoint
DROP FUNCTION "form_record_stays_signed"();--> statement-breakpoint
DROP TYPE "form_record_status";
