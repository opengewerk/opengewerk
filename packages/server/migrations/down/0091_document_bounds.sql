-- Takes the limits of a document out again, back to how 0090 left things.
--
-- Nothing is written and no row is touched. A line or a text written while
-- 0091 was in place stays as it is.
--
-- Run as the superuser, like every rollback.
DROP TRIGGER IF EXISTS "document_lines_within_count_changed" ON "document_lines";
DROP TRIGGER IF EXISTS "document_lines_within_count_inserted" ON "document_lines";
DROP FUNCTION IF EXISTS "document_lines_within_count"();
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_texts_fit";
ALTER TABLE "document_lines" DROP CONSTRAINT IF EXISTS "document_lines_description_fits";
ALTER TABLE "document_lines" DROP CONSTRAINT IF EXISTS "document_lines_designation_fits";
