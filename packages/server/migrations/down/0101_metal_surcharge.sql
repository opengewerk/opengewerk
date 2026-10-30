-- Takes back 0101 (#462). The copper goes back to its columns of
-- `supplier_articles`, any other metal and the metal prices go with their
-- tables, and so does what a supplier or an article said about the markup on
-- the surcharge. A supplier's row that said only that goes, and so does an
-- article's. The setting `material.markup_on_metal` stays in its enum, as a
-- value cannot be taken out of one (0066); its rows go.
ALTER TABLE "supplier_articles" ADD COLUMN "copper_base_euros" integer;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD COLUMN "copper_grams_per_thousand" integer;--> statement-breakpoint
ALTER TABLE "supplier_articles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_article_metals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_markups" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_markups" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_parameters" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "supplier_articles" AS "s"
   SET "copper_base_euros" = "m"."base_euros", "copper_grams_per_thousand" = "m"."grams_per_thousand"
  FROM "supplier_article_metals" AS "m"
 WHERE "m"."supplier_article_id" = "s"."id" AND "m"."metal" = 'copper';--> statement-breakpoint
DELETE FROM "supplier_markups" WHERE "basis_points" IS NULL;--> statement-breakpoint
DELETE FROM "article_markups" WHERE NOT "fixed" AND "basis_points" IS NULL;--> statement-breakpoint
DELETE FROM "tenant_parameters" WHERE "key" = 'material.markup_on_metal';--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_parameters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_markups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_markups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_copper_whole" CHECK (("supplier_articles"."copper_base_euros" is null) = ("supplier_articles"."copper_grams_per_thousand" is null));--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_copper_in_range" CHECK ("supplier_articles"."copper_base_euros" between 0 and 9999999 and "supplier_articles"."copper_grams_per_thousand" between 0 and 999999900);--> statement-breakpoint
GRANT UPDATE ("copper_base_euros", "copper_grams_per_thousand") ON "supplier_articles" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "article_markups" DROP CONSTRAINT "article_markups_say_something";--> statement-breakpoint
ALTER TABLE "article_markups" DROP CONSTRAINT "article_markups_fixed_without_own";--> statement-breakpoint
ALTER TABLE "article_markups" ADD CONSTRAINT "article_markups_fixed_or_own" CHECK ("article_markups"."fixed" = ("article_markups"."basis_points" is null));--> statement-breakpoint
ALTER TABLE "article_markups" DROP COLUMN "markup_on_metal";--> statement-breakpoint
ALTER TABLE "supplier_markups" DROP CONSTRAINT "supplier_markups_say_something";--> statement-breakpoint
ALTER TABLE "supplier_markups" DROP COLUMN "markup_on_metal";--> statement-breakpoint
ALTER TABLE "supplier_markups" ALTER COLUMN "basis_points" SET NOT NULL;--> statement-breakpoint
DROP TABLE "supplier_metal_prices";--> statement-breakpoint
DROP TABLE "supplier_article_metals";--> statement-breakpoint
DROP TYPE "public"."metal";
