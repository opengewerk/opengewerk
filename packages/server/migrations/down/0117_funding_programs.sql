-- Takes back 0117 (#307). A funding programme is what the office typed in,
-- and a capacity or a power what it read off a data sheet: this rollback
-- deletes none of them. While there is one, it stops, the way the rollback of
-- 0116 stops at a grid operator. Which they are, this shows:
--
--   select id, name from funding_programs;
--   select id, designation, usable_capacity_wh, rated_power_w from installations where usable_capacity_wh is not null or rated_power_w is not null;
--
-- The rights "Förderprogramme ansehen" and "Förderprogramme pflegen" stay in
-- the roles that have them, where they ask for nothing any more.
--
-- The owner sees no row of a table under FORCE, so the check looks past the
-- policy, and in one statement with switching it off and on again: if the
-- check stops, nothing of it stays changed.
DO $$
BEGIN
	ALTER TABLE "funding_programs" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "installations" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "funding_programs")
		OR EXISTS (
			SELECT 1 FROM "installations"
			WHERE "usable_capacity_wh" IS NOT NULL OR "rated_power_w" IS NOT NULL
		) THEN
		RAISE EXCEPTION 'Es gibt Förderprogramme oder Anlagen mit Kapazität oder Bemessungsleistung (#307). Die Rücknahme von 0117 löscht sie nicht und bricht deshalb ab; wer sie trotzdem braucht, sichert die Datenbank und entfernt sie vorher selbst. Welche es sind, zeigen die Abfragen in der Rücknahme von 0117.';
	END IF;

	ALTER TABLE "installations" FORCE ROW LEVEL SECURITY;
END
$$;--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_ratings";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "usable_capacity_wh";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "rated_power_w";--> statement-breakpoint
DROP TABLE "funding_programs";
