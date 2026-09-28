-- How many units a selling or purchase price of an article is for, #456,
-- as a wholesaler prices cable ties per 100 pieces. Every existing price is
-- for one unit, which the default gives it; the previous version of the
-- application writes none and gets the same. article_prices keeps its sync
-- columns and triggers, which see the new column without a change; neither
-- table's grants name columns. Nothing is written to a row.

ALTER TABLE "article_prices" ADD COLUMN "price_base" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_prices" ADD COLUMN "price_base" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "article_prices" ADD CONSTRAINT "article_prices_price_base_known" CHECK ("article_prices"."price_base" in (1, 10, 100, 1000));--> statement-breakpoint
ALTER TABLE "purchase_prices" ADD CONSTRAINT "purchase_prices_price_base_known" CHECK ("purchase_prices"."price_base" in (1, 10, 100, 1000));