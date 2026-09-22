-- The payment term of a single document, in days, when it is not the
-- business's setting. Empty for every document written so far, which is
-- what they meant: the setting applies, as it stood on the document's date.
--
-- The range is the one the routes and the sync refuse to go beyond, held
-- here for every other way in. An issued document keeps what it stated in
-- its snapshot, and `documents_stay_fixed` compares whole rows, so the new
-- column is fixed with the rest from the moment a document is issued.
ALTER TABLE "documents" ADD COLUMN "payment_term_days" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_term_days" CHECK ("documents"."payment_term_days" is null
        or "documents"."payment_term_days" between 0 and 365);