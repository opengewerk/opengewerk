-- Takes back 0119 (#311). A defect, its steps and the photos assigned to it
-- are records the business keeps, the reservations of an acceptance among
-- them: this rollback deletes none of them. While there is one, it stops.
-- Which they are, this shows:
--
--   select id, job_id, installation_id, status, description from defects;
--   select id, title, defect_id from attachments where defect_id is not null;
--
-- The owner sees no row of a table under FORCE, so the check looks past the
-- policy, and in one statement with switching it off and on again: if the
-- check stops, nothing of it stays changed.
DO $$
BEGIN
	ALTER TABLE "defects" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "defects") OR EXISTS (SELECT 1 FROM "attachments" WHERE "defect_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt Mängel oder Fotos von Mängeln (#311). Die Rücknahme von 0119 löscht sie nicht und bricht deshalb ab; wer sie trotzdem braucht, sichert die Datenbank und entfernt sie vorher selbst. Welche es sind, zeigen die Abfragen in der Rücknahme von 0119.';
	END IF;

	ALTER TABLE "defects" FORCE ROW LEVEL SECURITY;
	ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
END
$$;--> statement-breakpoint
DROP TRIGGER "form_records_defects_from_acceptance" ON "form_records";--> statement-breakpoint
DROP FUNCTION "defects_from_acceptance"();--> statement-breakpoint
DROP TRIGGER "attachments_defect_at_its_place" ON "attachments";--> statement-breakpoint
DROP FUNCTION "defect_photo_at_its_place"();--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_defect_in_tenant";--> statement-breakpoint
DROP INDEX "attachments_defect_idx";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "defect_id";--> statement-breakpoint
DROP TABLE "defect_steps";--> statement-breakpoint
DROP TABLE "defects";--> statement-breakpoint
DROP FUNCTION "take_defect_step"();--> statement-breakpoint
DROP FUNCTION "defect_changes"();--> statement-breakpoint
DROP TYPE "public"."defect_step";--> statement-breakpoint
DROP TYPE "public"."defect_status";--> statement-breakpoint
ALTER TABLE "form_records" DROP CONSTRAINT "form_records_tenant_id_key";
