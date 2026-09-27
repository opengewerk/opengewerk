-- Rolling the deliveries of the ways into a site back to how 0054 left the
-- schema (#286).
--
-- What it costs an installation that runs it: the record of which person got
-- which value on a device. Run as the superuser, like every rollback; the
-- audit log keeps its entries about the table.

DROP TABLE "site_access_deliveries";
