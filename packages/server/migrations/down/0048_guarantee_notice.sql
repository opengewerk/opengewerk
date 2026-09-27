-- Rolling back the notice on the legal guarantee, #431.
--
-- What it costs an installation that runs it: the row of the notice is gone in
-- every business; a document that carried it keeps it in its snapshot, and the
-- PDF it kept keeps the page.
--
-- PostgreSQL does not take a value out of an enum, so the type is rebuilt
-- without it, the way 0029 does it. The data goes first, while the type still
-- knows every value.

DELETE FROM "instructions" WHERE "template" = 'guarantee_notice';--> statement-breakpoint

ALTER TABLE "instructions" ALTER COLUMN "template" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."instruction_template";--> statement-breakpoint
CREATE TYPE "public"."instruction_template" AS ENUM('withdrawal', 'withdrawal_form', 'early_start', 'withdrawal_notes');--> statement-breakpoint
ALTER TABLE "instructions" ALTER COLUMN "template" SET DATA TYPE "public"."instruction_template" USING "template"::"public"."instruction_template";
