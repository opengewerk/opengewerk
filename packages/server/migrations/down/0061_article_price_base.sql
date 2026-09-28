-- Takes back 0061. Runs as the superuser, like every down migration.
-- A price for more than one unit reads as a price for one afterwards; take
-- such prices back by hand first, or they count a hundred times too much.

ALTER TABLE "purchase_prices" DROP CONSTRAINT IF EXISTS "purchase_prices_price_base_known";
ALTER TABLE "article_prices" DROP CONSTRAINT IF EXISTS "article_prices_price_base_known";
ALTER TABLE "purchase_prices" DROP COLUMN IF EXISTS "price_base";
ALTER TABLE "article_prices" DROP COLUMN IF EXISTS "price_base";
