-- Takes back 0114 (#303). Appliances and their test protocols are records a
-- business keeps, and a signed protocol is evidence: this rollback deletes
-- none of them. While there is one, it stops, the way the rollback of 0034
-- stops at a line it would have to change. Which they are, this shows:
--
--   select id, site_id, designation from appliances;
--   select id, appliance_id, status from form_records where appliance_id is not null;
--
-- The owner sees no row of a table under FORCE, so the check looks past the
-- policy, and in one statement with switching it off and on again: if the
-- check stops, nothing of it stays changed. The three units stay in
-- `rule_unit`, since a value cannot be taken out of an enum and an unused one
-- does no harm (as in the rollback of 0077).
DO $$
BEGIN
	ALTER TABLE "appliances" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "form_records" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "appliances")
		OR EXISTS (SELECT 1 FROM "form_records" WHERE "appliance_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt Geräte oder Prüfprotokolle an Geräten (#303). Die Rücknahme von 0114 löscht keine Nachweise und bricht deshalb ab; wer sie trotzdem braucht, sichert die Datenbank und entfernt die Geräte und ihre Protokolle vorher selbst. Welche es sind, zeigen die Abfragen in der Rücknahme von 0114.';
	END IF;

	ALTER TABLE "form_records" FORCE ROW LEVEL SECURITY;
END
$$;--> statement-breakpoint
ALTER TABLE "form_records" DROP CONSTRAINT "form_records_one_subject";--> statement-breakpoint
ALTER TABLE "form_records" DROP CONSTRAINT "form_records_appliance_in_tenant";--> statement-breakpoint
DROP INDEX "form_records_appliance_idx";--> statement-breakpoint
ALTER TABLE "form_records" DROP COLUMN "appliance_id";--> statement-breakpoint
ALTER TABLE "form_records" ALTER COLUMN "installation_id" SET NOT NULL;--> statement-breakpoint
DROP TABLE "appliances";--> statement-breakpoint
DROP TYPE "public"."appliance_mobility";--> statement-breakpoint
DROP TYPE "public"."appliance_protection_class";
