-- Takes back 0128 (#313). An entry in the history is what somebody said or
-- noted, and this rollback deletes none. While there is one, it stops. Which
-- they are, this shows:
--
--   select customer_id, kind, happened_at from communications;

DO $$
BEGIN
	ALTER TABLE "communications" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "communications") THEN
		RAISE EXCEPTION 'Es gibt schon Einträge im Verlauf. Die Rücknahme von 0128 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "communications" FORCE ROW LEVEL SECURITY;
END
$$;

DROP TABLE "communications";
DROP TYPE "public"."call_direction";
DROP TYPE "public"."communication_kind";
