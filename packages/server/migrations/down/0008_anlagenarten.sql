-- Back to both enums as they stood. PostgreSQL does not take a value out of an
-- enum, so `installation_kind` is rebuilt without the two new ones, while
-- `distribution_board_kind` only needs the third value added again.
--
-- An installation that already carries `battery` or `meter` blocks the cast,
-- and that is the right way round: the rollback would have to write it down as
-- something it is not, and `other` is exactly the answer this migration exists
-- to stop giving.
ALTER TABLE "installations" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."installation_kind";--> statement-breakpoint
CREATE TYPE "public"."installation_kind" AS ENUM('pv_system', 'meter_cabinet', 'wallbox', 'heating', 'other');--> statement-breakpoint
ALTER TABLE "installations" ALTER COLUMN "kind" SET DATA TYPE "public"."installation_kind" USING "kind"::"public"."installation_kind";--> statement-breakpoint
ALTER TYPE "public"."distribution_board_kind" ADD VALUE 'meter_cabinet';
