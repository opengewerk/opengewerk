-- Takes back 0127 (#841). A decline is what a customer told the office, and
-- this rollback deletes none. While there is one, it stops. Which they are,
-- this shows:
--
--   select document_id, declined_on, reason from offer_declines;

DO $$
BEGIN
	ALTER TABLE "offer_declines" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "offer_declines") THEN
		RAISE EXCEPTION 'Es gibt schon abgelehnte Angebote. Die Rücknahme von 0127 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "offer_declines" FORCE ROW LEVEL SECURITY;
END
$$;

DROP TABLE "offer_declines";
