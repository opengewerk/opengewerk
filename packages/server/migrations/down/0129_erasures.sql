-- Takes back 0129 (#317). The protocol says which records the deletion
-- concept deleted, and this rollback deletes no line of it. While there is
-- one, it stops. Which they are, this shows:
--
--   select kind, label, created_at from erasures;
--
-- A kind that goes by itself is a setting and goes with the table.

DO $$
BEGIN
	ALTER TABLE "erasures" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "erasures") THEN
		RAISE EXCEPTION 'Es gibt schon Zeilen im Protokoll des Löschkonzepts. Die Rücknahme von 0129 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "erasures" FORCE ROW LEVEL SECURITY;
END
$$;

DROP TABLE "erasure_automations";
DROP TABLE "erasures";
DROP TYPE "public"."erasure_kind";
