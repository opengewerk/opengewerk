-- Die Rücknahme für 0010_belegpositionen.sql.
--
-- Der Spalte am Beleg zuerst, weil ihr Typ danach fällt. Die Zeilen gehen mit
-- der Tabelle, ihre Trigger und der Check mit ihr.
--
-- Was das nicht rückgängig macht: die Audit-Einträge, die `document_lines`
-- erzeugt hat, solange es die Tabelle gab. Sie bleiben, und sie müssen. Ein
-- Eintrag wird einmal geschrieben und nie wieder angefasst, die Kette ist über
-- die ganze Zeile gehasht, und ein Herausnehmen mitten aus ihr machte aus
-- einem heilen Log eines, das einen Bruch meldet.

DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "document_lines";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "document_lines";--> statement-breakpoint
DROP TRIGGER IF EXISTS "document_lines_stay_fixed" ON "document_lines";--> statement-breakpoint
DROP FUNCTION IF EXISTS "document_line_stays_fixed"();--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_isolation" ON "document_lines";--> statement-breakpoint
DROP TABLE IF EXISTS "document_lines";--> statement-breakpoint

ALTER TABLE "documents" DROP COLUMN IF EXISTS "tax_treatment";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."tax_treatment";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vat_rate";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."line_unit";
