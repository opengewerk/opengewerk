-- Rolling payments back to how 0038 left them.
--
-- What it costs an installation that runs it: the payments recorded on
-- invoices are gone with their table. A final invoice issued since keeps what
-- it took off in its snapshot, so no issued document changes; but the record
-- of what came in is part of the books, so the rollback stops while there is
-- a payment at all. Export them before taking this step.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "payments") THEN
		RAISE EXCEPTION 'Es gibt erfasste Zahlungseingänge. Sie gehören zu den Büchern; die Rücknahme bricht ab, damit sie nicht verloren gehen.';
	END IF;
END
$$;--> statement-breakpoint
DROP TABLE "payments";
