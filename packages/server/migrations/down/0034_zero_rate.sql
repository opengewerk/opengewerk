-- Takes the zero rate for photovoltaics back out of `vat_rate` (#127).
--
-- PostgreSQL does not take a value out of an enum, so the type is rebuilt
-- without it, the way the rollback of 0029 does it. A line that carries the
-- zero rate stops the rollback: turned into another rate it would change the
-- amount of a draft, and the line of an issued document cannot be changed at
-- all. Which lines they are, this shows:
--
--   select document_id, designation from document_lines where vat_rate = 'zero';
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "document_lines" WHERE "vat_rate" = 'zero') THEN
		RAISE EXCEPTION 'Es gibt Positionen mit dem Nullsteuersatz für Photovoltaik. Die ältere Fassung kennt ihn nicht, und eine Rücknahme würde ihre Beträge ändern. Sie bricht deshalb ab; welche Positionen es sind, zeigt die Abfrage in der Rücknahme von 0034.';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "document_lines" ALTER COLUMN "vat_rate" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "document_lines" ALTER COLUMN "vat_rate" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."vat_rate";--> statement-breakpoint
CREATE TYPE "public"."vat_rate" AS ENUM('standard', 'reduced');--> statement-breakpoint
ALTER TABLE "document_lines" ALTER COLUMN "vat_rate" SET DATA TYPE "public"."vat_rate" USING "vat_rate"::"public"."vat_rate";--> statement-breakpoint
ALTER TABLE "document_lines" ALTER COLUMN "vat_rate" SET DEFAULT 'standard';
