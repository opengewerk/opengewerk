-- Rolling the shipped instructions back to how 0027 left them.
--
-- What it costs an installation that runs it: the notes on when the right of
-- withdrawal ends are gone, the row of every business included; a document
-- that carried them keeps them in its snapshot. The other three are proposed
-- for the estimate as well again, sit where they sat, and the sheet gets its
-- old heading back. Whether the two models went out with the document is not
-- turned back: nobody can tell which row said otherwise before, and going out
-- with the document is the safe side.
--
-- PostgreSQL does not take a value out of an enum, so the type is rebuilt
-- without it, the way 0006 and 0008 do it. The data goes first, while the
-- type still knows every value.

DELETE FROM "instructions" WHERE "template" = 'withdrawal_notes';--> statement-breakpoint

UPDATE "instructions"
   SET "title" = 'Beginn vor Ablauf der Widerrufsfrist', "updated_at" = now()
 WHERE "template" = 'early_start'
   AND "title" = 'Verlangen auf vorzeitigen Leistungsbeginn';--> statement-breakpoint

UPDATE "instructions"
   SET "position" = CASE "template" WHEN 'withdrawal_form' THEN 2 ELSE 3 END,
       "updated_at" = now()
 WHERE ("template" = 'withdrawal_form' AND "position" = 3)
    OR ("template" = 'early_start' AND "position" = 4);--> statement-breakpoint

UPDATE "instructions"
   SET "kinds" = '{cost_estimate,quote}', "updated_at" = now()
 WHERE "template" IN ('withdrawal', 'withdrawal_form', 'early_start')
   AND "kinds" = '{quote}';--> statement-breakpoint

ALTER TABLE "instructions" ALTER COLUMN "template" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."instruction_template";--> statement-breakpoint
CREATE TYPE "public"."instruction_template" AS ENUM('withdrawal', 'withdrawal_form', 'early_start');--> statement-breakpoint
ALTER TABLE "instructions" ALTER COLUMN "template" SET DATA TYPE "public"."instruction_template" USING "template"::"public"."instruction_template";
