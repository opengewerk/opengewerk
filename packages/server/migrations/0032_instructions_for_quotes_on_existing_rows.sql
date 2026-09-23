-- What 0029 was meant to do to the instructions a business already had.
--
-- Written by hand; the schema does not change.
--
-- 0029 proposed the three shipped instructions of 0027 for the quote alone,
-- sent the two models out with the document, moved the form and the sheet
-- for an early start one place down to make room for the notes on when the
-- right of withdrawal ends, and gave the sheet its new heading. It did so with four
-- UPDATEs, and none of them found a row. Migrations run as the owner of the
-- tables, `instructions` stands on FORCE ROW LEVEL SECURITY like every table
-- of a business, and no policy names the owner: the owner sees no row, an
-- UPDATE changes none, and it says so by succeeding. Measured on 22.09.2026,
-- see the addenda to ADR 0003. A business that had its instructions before
-- 0029 still has them proposed for the estimate, the form in second place
-- beside the notes, and the old heading in the row. Nothing shows that
-- heading, screen and print take it from the package; it is set right all the
-- same, so that row and package agree, which is what 0029 was after.
--
-- The same four statements again, with FORCE lifted for the length of them,
-- inside the transaction every pending migration runs in: the owner sees every
-- row then, and a failure takes the switch back with everything else. 0029
-- itself stays as it is, a merged migration is not changed.
--
-- **The same conditions, and why they still hold.** Each statement touches a
-- row only while it carries exactly what 0027 wrote, as 0029 would have. For
-- three of them nothing else can have written that since #111: no route sets
-- the position or the heading of a shipped instruction, and the two models may
-- not be kept from going out with a quote. The estimate can be added to the
-- proposal by hand again, and a row that was is set to the quote alone. 0029
-- weighed exactly that, and the day in between changes nothing about it.
--
-- **Named in the audit log.** Every changed row gets its entries there like
-- any other change, and the reason says where they came from: `migration`,
-- for the length of these statements and not for whatever runs after them in
-- the same transaction.
--
-- On a database set up after 0029, or one without instructions, every
-- statement finds nothing to do.

ALTER TABLE "instructions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint

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
   AND "title" = 'Beginn vor Ablauf der Widerrufsfrist';--> statement-breakpoint

SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "instructions" FORCE ROW LEVEL SECURITY;
