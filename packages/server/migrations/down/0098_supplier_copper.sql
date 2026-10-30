-- Rolling the copper of the articles back (#297). The figures go with their
-- columns; the next import brings them again.
ALTER TABLE "supplier_articles" DROP CONSTRAINT "supplier_articles_copper_in_range";--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP CONSTRAINT "supplier_articles_copper_whole";--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP COLUMN "copper_grams_per_thousand";--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP COLUMN "copper_base_euros";
