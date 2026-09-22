-- The shipped instructions after Moritz's decisions of 22.09.2026, #109.
--
-- The first line comes from the schema, everything after it is written by
-- hand.
--
-- **A fourth shipped instruction.** `withdrawal_notes` carries what
-- Art. 246a § 1 (3) EGBGB asks for beyond the model: when there is no right
-- of withdrawal, and when it ends early. The words are the ones Moritz uses on
-- msk-solutions.de. A value added to an enum may not be used in the
-- transaction that adds it, and all pending migrations run in one; nothing
-- below touches it, and the rows for it are written by the server the first
-- time a business asks, like every shipped instruction.
--
-- **The quote alone.** The instruction on withdrawal, its notes and its form
-- are compulsory with a quote to a consumer and not needed with an estimate.
-- The rows written since 0027 that still carry the old start, estimate and
-- quote, get the new one. A business that chose exactly the old start on
-- purpose cannot be told apart from one that never looked, and could not have
-- done so for long: the start changed on the day it shipped.
--
-- **With the document.** The two models go out with the document from now
-- on, whatever the row says; a row that says otherwise is set right, so that
-- the screen says what happens.
--
-- **In the order they are printed.** The notes follow the instruction on
-- withdrawal and come before the form, so the form moves to three and the
-- sheet for an early start to four. No screen sets a position yet, so a row
-- in another place was not put there by anybody.
--
-- **The sheet's new heading.** It is printed under the heading of the
-- package, "Verlangen auf vorzeitigen Leistungsbeginn" as on msk-solutions.de;
-- the rows get it too, so that the settings say the same.

ALTER TYPE "public"."instruction_template" ADD VALUE 'withdrawal_notes';
--> statement-breakpoint

UPDATE "instructions"
   SET "kinds" = '{quote}', "updated_at" = now()
 WHERE "template" IN ('withdrawal', 'withdrawal_form', 'early_start')
   AND "kinds" = '{cost_estimate,quote}';--> statement-breakpoint

UPDATE "instructions"
   SET "with_document" = true, "updated_at" = now()
 WHERE "template" IN ('withdrawal', 'withdrawal_form')
   AND NOT "with_document";--> statement-breakpoint

UPDATE "instructions"
   SET "position" = CASE "template" WHEN 'withdrawal_form' THEN 3 ELSE 4 END,
       "updated_at" = now()
 WHERE ("template" = 'withdrawal_form' AND "position" = 2)
    OR ("template" = 'early_start' AND "position" = 3);--> statement-breakpoint

UPDATE "instructions"
   SET "title" = 'Verlangen auf vorzeitigen Leistungsbeginn', "updated_at" = now()
 WHERE "template" = 'early_start'
   AND "title" = 'Beginn vor Ablauf der Widerrufsfrist';
