-- Takes back 0108: the guarantee of durability goes from the articles, with its two checks.
ALTER TABLE "articles" DROP CONSTRAINT "articles_durability_fits";--> statement-breakpoint
ALTER TABLE "articles" DROP CONSTRAINT "articles_durability_whole";--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN "durability_model";--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN "durability_producer";--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN "durability_half_years";
