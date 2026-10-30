-- The copper of an article at a supplier (#297, #462): the base in euros for
-- 100 kg and the weight in grams for 1000 of the article's units, read from the
-- second record of DATANORM. The surcharge is worked out from them in #462.
--
-- Both or neither, and the application role may write them, as it writes the
-- discount group: only an import does.
--
-- **Fits the version before it**: two columns it does not know, empty for
-- every row there is; it writes its rows as before.
ALTER TABLE "supplier_articles" ADD COLUMN "copper_base_euros" integer;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD COLUMN "copper_grams_per_thousand" integer;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_copper_whole" CHECK (("supplier_articles"."copper_base_euros" is null) = ("supplier_articles"."copper_grams_per_thousand" is null));--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_copper_in_range" CHECK ("supplier_articles"."copper_base_euros" between 0 and 9999999 and "supplier_articles"."copper_grams_per_thousand" between 0 and 999999900);--> statement-breakpoint
GRANT UPDATE ("copper_base_euros", "copper_grams_per_thousand") ON "supplier_articles" TO "opengewerk_app";
