-- The meter cabinet is an installation, and only an installation.
--
-- It stood in both enums: as an `installation_kind` and as the third value of
-- `distribution_board_kind`. Two levels, one thing, and nothing anywhere said
-- which of them was meant. Section 3.2 of the concept does say: it lists the
-- boards as NSHV and UV, and the cabinet as the place the label is stuck on.
-- No board was ever created with the value either, all five uses in the
-- repository create an installation, so it goes, and the boards inside a
-- cabinet stay what they are, a main or a sub distribution.
--
-- Storage and meter come the other way: the same section puts both beside the
-- PV system rather than below it, and both fell to `other` here, which loses
-- what they are on the one field that says it.
--
-- Two notes on the shape of this. The cast at the end fails on a row that
-- still holds `meter_cabinet` instead of quietly turning it into something
-- else, which is what should happen: every migration runs in one transaction,
-- so such an update stops with the database on the state it had. And the
-- application running while this executes is still the old one for a moment,
-- the one whose type accepts `meter_cabinet` on a board. Today that costs
-- nothing, there is no sign in and no instance holding data; once there is,
-- removing an enum value is a type swap with a data migration.
ALTER TYPE "public"."installation_kind" ADD VALUE 'battery' BEFORE 'meter_cabinet';--> statement-breakpoint
ALTER TYPE "public"."installation_kind" ADD VALUE 'meter' BEFORE 'meter_cabinet';--> statement-breakpoint
ALTER TABLE "distribution_boards" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."distribution_board_kind";--> statement-breakpoint
CREATE TYPE "public"."distribution_board_kind" AS ENUM('main_distribution', 'sub_distribution');--> statement-breakpoint
ALTER TABLE "distribution_boards" ALTER COLUMN "kind" SET DATA TYPE "public"."distribution_board_kind" USING "kind"::"public"."distribution_board_kind";
