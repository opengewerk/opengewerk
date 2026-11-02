-- Takes back 0115 (#305). A handover is the folder a business gave its
-- customer, and a forecast is what the office typed in: this rollback deletes
-- neither. While there is one, it stops, the way the rollback of 0114 stops
-- at an appliance. Which they are, this shows:
--
--   select id, installation_id, handed_over_on from pv_handovers;
--   select id, designation, yield_forecast_kwh from installations where yield_forecast_kwh is not null or yield_forecast_source is not null;
--
-- The owner sees no row of a table under FORCE, so the check looks past the
-- policy, and in one statement with switching it off and on again: if the
-- check stops, nothing of it stays changed.
DO $$
BEGIN
	ALTER TABLE "pv_handovers" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "installations" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "pv_handovers")
		OR EXISTS (
			SELECT 1 FROM "installations"
			WHERE "yield_forecast_kwh" IS NOT NULL OR "yield_forecast_source" IS NOT NULL
		) THEN
		RAISE EXCEPTION 'Es gibt Übergaben von PV-Unterlagen oder Ertragsprognosen (#305). Die Rücknahme von 0115 löscht sie nicht und bricht deshalb ab; wer sie trotzdem braucht, sichert die Datenbank und entfernt sie vorher selbst. Welche es sind, zeigen die Abfragen in der Rücknahme von 0115.';
	END IF;

	ALTER TABLE "installations" FORCE ROW LEVEL SECURITY;
END
$$;--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_yield_forecast";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "yield_forecast_kwh";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "yield_forecast_source";--> statement-breakpoint
DROP TABLE "pv_handovers";
