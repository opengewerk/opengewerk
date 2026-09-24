-- Rolling the fields of the reports back to how 0043 left them.
--
-- What it costs an installation that runs it: the fields a business gave its
-- reports and every value filled into them, part of what customers signed.
-- The rollback therefore stops while there is a single definition.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "form_definitions") THEN
		RAISE EXCEPTION 'Es gibt Felder für den Regiebericht. Berichte sind damit ausgefüllt und unterschrieben; die Rücknahme bricht ab, damit nichts davon verloren geht.';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_field_values";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "field_values";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "fields_version";--> statement-breakpoint
DROP TABLE "form_definitions";--> statement-breakpoint
DROP FUNCTION "form_definition_stays"();
