-- Rolling the job numbers back to how 0036 left them.
--
-- What it costs an installation that runs it: the job number range goes, with
-- the pattern and the next number a business set for it. The numbers jobs
-- already carry stay in their column; the older version neither shows them
-- nor hands out new ones.
--
-- PostgreSQL does not take a value out of an enum, so the type is rebuilt
-- without it, the way 0029 does it. The row goes first, while the type still
-- knows every value.

DELETE FROM "number_ranges" WHERE "key" = 'job';--> statement-breakpoint
ALTER TABLE "number_ranges" ALTER COLUMN "key" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."number_range_key";--> statement-breakpoint
CREATE TYPE "public"."number_range_key" AS ENUM('quote', 'order_confirmation', 'delivery_note', 'report', 'invoice');--> statement-breakpoint
ALTER TABLE "number_ranges" ALTER COLUMN "key" SET DATA TYPE "public"."number_range_key" USING "key"::"public"."number_range_key";
