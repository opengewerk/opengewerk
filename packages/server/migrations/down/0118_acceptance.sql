-- Takes back 0118 (#310). An acceptance is a signed form the business keeps
-- as proof, and a job's VOB/B and building and an installation's guarantee are
-- what the office decided or typed in: this rollback deletes none of them.
-- While there is one, it stops. Which they are, this shows:
--
--   select id, job_id, performed_on, status from form_records where installation_id is null and appliance_id is null;
--   select id, designation, vob_agreed, building_work from jobs where vob_agreed or building_work is not null;
--   select id, designation, manufacturer_warranty_ends_on from installations where manufacturer_warranty_ends_on is not null;
--
-- The owner sees no row of a table under FORCE, so the check looks past the
-- policy, and in one statement with switching it off and on again: if the
-- check stops, nothing of it stays changed.
DO $$
BEGIN
	ALTER TABLE "form_records" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "jobs" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "installations" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "form_records" WHERE "installation_id" IS NULL AND "appliance_id" IS NULL)
		OR EXISTS (SELECT 1 FROM "jobs" WHERE "vob_agreed" OR "building_work" IS NOT NULL)
		OR EXISTS (SELECT 1 FROM "installations" WHERE "manufacturer_warranty_ends_on" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt Abnahmeprotokolle, Aufträge mit VOB/B oder Bauwerk oder Anlagen mit Herstellergarantie (#310). Die Rücknahme von 0118 löscht sie nicht und bricht deshalb ab; wer sie trotzdem braucht, sichert die Datenbank und entfernt sie vorher selbst. Welche es sind, zeigen die Abfragen in der Rücknahme von 0118.';
	END IF;

	ALTER TABLE "form_records" FORCE ROW LEVEL SECURITY;
	ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
	ALTER TABLE "installations" FORCE ROW LEVEL SECURITY;
END
$$;--> statement-breakpoint
ALTER TABLE "form_records" DROP CONSTRAINT "form_records_one_subject";--> statement-breakpoint
DROP INDEX "form_records_job_idx";--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_one_subject" CHECK (num_nonnulls("form_records"."installation_id", "form_records"."appliance_id") = 1);--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "manufacturer_warranty_ends_on";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "vob_agreed";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "building_work";
