-- Rolling working time back.
--
-- What it costs an installation that runs it: every time entry and every
-- answer about consent is gone with its table. That is the record § 17 MiLoG
-- wants kept for two years, so the rollback stops while there is an entry at
-- all; export what the law wants kept before taking this step.
--
-- `rule_unit` loses its two new values the only way PostgreSQL allows, by
-- being built again, the way the rollback of 0034 does it with `vat_rate`. A
-- business parameter in minutes or years would stop that, and none can exist:
-- no parameter uses either.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about both tables, the same choice as in every earlier rollback.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "time_entries") THEN
		RAISE EXCEPTION 'Es gibt Zeiteinträge. Sie sind die Aufzeichnung nach § 17 MiLoG und werden zwei Jahre aufbewahrt; die Rücknahme bricht deshalb ab.';
	END IF;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "time_entries_stay_as_written" ON "time_entries";--> statement-breakpoint
DROP TRIGGER IF EXISTS "time_entries_record_owner" ON "time_entries";--> statement-breakpoint
DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "time_entries";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "time_entries";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "time_entries";--> statement-breakpoint
DROP TABLE IF EXISTS "time_entries";--> statement-breakpoint
DROP TRIGGER IF EXISTS "location_consents_record_owner" ON "location_consents";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "location_consents";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "location_consents";--> statement-breakpoint
DROP TABLE IF EXISTS "location_consents";--> statement-breakpoint
DROP FUNCTION IF EXISTS "time_entry_stays_as_written"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_time_owner"();--> statement-breakpoint
DROP TYPE IF EXISTS "public"."time_entry_kind";--> statement-breakpoint
ALTER TABLE "tenant_parameters" ALTER COLUMN "unit" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."rule_unit";--> statement-breakpoint
CREATE TYPE "public"."rule_unit" AS ENUM('basis_points', 'cents', 'days', 'flag');--> statement-breakpoint
ALTER TABLE "tenant_parameters" ALTER COLUMN "unit" SET DATA TYPE "public"."rule_unit" USING "unit"::"public"."rule_unit";
