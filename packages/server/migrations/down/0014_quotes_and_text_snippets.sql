-- Rolling titles, document texts and snippets back.
--
-- What it costs an installation that runs it: a title among the lines of a
-- document loses the column that said it was one and reads as a position
-- afterwards, with its heading as the designation and no amount. The check
-- kept it at zero, so no total changes; what changes is that it prints as a
-- position of zero instead of as a heading. Deleting the titles instead would
-- have to reach into issued documents, which the trigger from 0010 refuses,
-- and a rollback that rewrites issued documents is not one to run.
--
-- The texts above and below the lines go with their columns, the snippets with
-- their table. The snapshots of issued documents are not touched and keep
-- their titles and texts; the version before this one ignores what it does
-- not know in them, so it prints their titles the way it prints the lines
-- above, as positions of zero, and leaves the texts off. A PDF that was already
-- stored stays the PDF that was sent.
--
-- The audit log keeps its entries about `text_snippets`, the same choice as in
-- every earlier rollback.

DROP TRIGGER IF EXISTS "audit_changes" ON "text_snippets";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "text_snippets";--> statement-breakpoint
DROP TABLE IF EXISTS "text_snippets";--> statement-breakpoint

ALTER TABLE "document_lines" DROP CONSTRAINT IF EXISTS "document_lines_title_has_no_amount";--> statement-breakpoint
ALTER TABLE "document_lines" DROP COLUMN IF EXISTS "kind";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "closing_text";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "intro_text";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."snippet_purpose";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."line_kind";
