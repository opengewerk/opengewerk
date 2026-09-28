-- Takes back 0060. Runs as the superuser, like every down migration.
-- Fails on the old check when a line with a price unit other than one exists:
-- such a line would add up wrong without the column, and it stays until it is
-- dealt with by hand.

ALTER TABLE "document_lines" DROP CONSTRAINT IF EXISTS "document_lines_lump_sum_per_one";
ALTER TABLE "document_lines" DROP CONSTRAINT IF EXISTS "document_lines_price_base_known";
ALTER TABLE "document_lines" DROP CONSTRAINT IF EXISTS "document_lines_net_matches_quantity";
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_net_matches_quantity" CHECK ("document_lines"."net_cents" = sign("document_lines"."quantity_milli"::numeric * "document_lines"."unit_price_cents")
        * round(abs("document_lines"."quantity_milli"::numeric * "document_lines"."unit_price_cents") / 1000));
ALTER TABLE "document_lines" DROP COLUMN IF EXISTS "price_base";
