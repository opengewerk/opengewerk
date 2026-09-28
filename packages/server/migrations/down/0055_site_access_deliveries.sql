-- Rolling the deliveries of the ways into a site back to how 0054 left the
-- schema (#286).
--
-- What it costs an installation that runs it: the record of which device got
-- which value, and of which value a showing showed. Run as the superuser, like
-- every rollback; the audit log keeps its entries about the table and the
-- column.

DROP TABLE "site_access_deliveries";--> statement-breakpoint
ALTER TABLE "site_access_reveals" DROP COLUMN "value_set_at";
