-- Rolling collective invoices back to how 0040 left them.
--
-- What it costs an installation that runs it: which reports a collective
-- invoice was made out of is gone with the table, and every report in one
-- would look open again, ready to be billed a second time. The rollback
-- therefore stops while there is a single source. Cancel or delete the
-- collective invoices first, or keep this version.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "document_sources" WHERE "released_at" IS NULL) THEN
		RAISE EXCEPTION 'Es gibt Sammelrechnungen über Regieberichte. Ohne die Tabelle sähen deren Berichte wieder offen aus und ließen sich ein zweites Mal abrechnen; die Rücknahme bricht deshalb ab.';
	END IF;
END
$$;--> statement-breakpoint
DROP TRIGGER "documents_release_sources" ON "documents";--> statement-breakpoint
DROP FUNCTION "release_sources"();--> statement-breakpoint
DROP TRIGGER "documents_successor_of_uncollected_report" ON "documents";--> statement-breakpoint
DROP FUNCTION "successor_of_uncollected_report"();--> statement-breakpoint
DROP TABLE "document_sources";--> statement-breakpoint
DROP FUNCTION "source_fits_invoice"();
