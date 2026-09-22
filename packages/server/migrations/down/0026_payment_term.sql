-- Rolling back the payment term of a single document.
--
-- The column goes, and with it the terms drafts stated for themselves; they
-- fall back to the business's setting. What an issued document stated stays
-- in its snapshot, which this does not touch.
ALTER TABLE "documents" DROP CONSTRAINT "documents_payment_term_days";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "payment_term_days";
