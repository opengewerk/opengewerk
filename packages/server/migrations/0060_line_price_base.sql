-- How many units the price of a document line is for, #456: one, ten, a
-- hundred or a thousand, as a wholesaler prices cable ties per 100 pieces.
-- Every existing line is for one unit, which is what the default gives it,
-- and the net amount of such a line is the same under the new check as under
-- the old one: the check is replaced, not loosened. The previous version of
-- the application, still running while this runs, writes no price unit and
-- gets the default. The grants on document_lines are on the whole table and
-- cover the new column; the audit and sync triggers see it without a change.

ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_net_matches_quantity";--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "price_base" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_price_base_known" CHECK ("document_lines"."price_base" in (1, 10, 100, 1000));--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_net_matches_quantity" CHECK ("document_lines"."net_cents" = sign("document_lines"."quantity_milli"::numeric * "document_lines"."unit_price_cents")
        * round(abs("document_lines"."quantity_milli"::numeric * "document_lines"."unit_price_cents")
          / (1000 * "document_lines"."price_base")));