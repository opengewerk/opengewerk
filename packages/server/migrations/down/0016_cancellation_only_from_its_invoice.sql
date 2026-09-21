-- Rolling back the rule that a cancellation invoice is only ever made out of
-- the invoice it cancels.
--
-- What it costs an installation that runs it: nothing in its data changes.
-- Every cancellation invoice that exists stays as it was, issued and frozen by
-- the triggers from before. What goes is the guard against the next one being
-- written by hand.

DROP TRIGGER IF EXISTS "documents_cancellation_only_from_its_invoice" ON "documents";--> statement-breakpoint
DROP FUNCTION IF EXISTS "cancellation_only_from_its_invoice"();
