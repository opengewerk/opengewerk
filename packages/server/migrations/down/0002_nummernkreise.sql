-- Die Rücknahme zu 0002_nummernkreise.sql.

DROP TRIGGER IF EXISTS "documents_stay_fixed" ON "documents";--> statement-breakpoint
DROP FUNCTION IF EXISTS "document_stays_fixed"();--> statement-breakpoint

DROP INDEX IF EXISTS "documents_number_unique";--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_isolation" ON "number_ranges";--> statement-breakpoint
DROP TABLE IF EXISTS "number_ranges";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."number_range_key";
