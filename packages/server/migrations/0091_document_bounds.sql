-- How much a document may hold: the texts of its lines and its own texts have
-- a length, and a document has at most 2000 lines.
--
-- Until now neither had a limit, while the fields of a report and the texts of
-- an article had one. A member who may write documents could fill the
-- database every business of the instance shares, with lines of any length
-- and any number of them, and the log keeps every one of them for good. The
-- limits stand far above what a document is written with; the domain holds
-- them as `lineLimits` and `documentTextLimits`, and the routes and the sync
-- ask them first, with a sentence.
--
-- The checks are NOT VALID: they hold for every row written from now on and
-- leave the rows that are there unread, so that an issued document longer
-- than they allow stays as it was issued. The count is a trigger after each
-- statement, over the documents its rows went to, and refuses with OG007.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this migration runs on unchanged, and is refused only what it could
-- not write here either.
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_designation_fits" CHECK (char_length("document_lines"."designation") <= 1000) NOT VALID;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_description_fits" CHECK ("document_lines"."description" is null
        or char_length("document_lines"."description") <= 30000) NOT VALID;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_texts_fit" CHECK (coalesce(char_length("documents"."subject"), 0) <= 500
        and coalesce(char_length("documents"."intro_text"), 0) <= 30000
        and coalesce(char_length("documents"."closing_text"), 0) <= 30000) NOT VALID;--> statement-breakpoint

CREATE FUNCTION "document_lines_within_count"() RETURNS trigger AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM public.document_lines l
		WHERE l.document_id IN (SELECT DISTINCT a.document_id FROM added a)
			AND l.deleted_at IS NULL
		GROUP BY l.document_id
		HAVING count(*) > 2000
	) THEN
		RAISE EXCEPTION 'Ein Beleg hat höchstens 2.000 Positionen.'
			USING ERRCODE = 'OG007';
	END IF;

	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- After an insert, and after a change that can bring a line to a document:
-- one moved to another, or one taken back from deleted.
CREATE TRIGGER "document_lines_within_count_inserted" AFTER INSERT ON "document_lines"
	REFERENCING NEW TABLE AS added
	FOR EACH STATEMENT EXECUTE FUNCTION "document_lines_within_count"();--> statement-breakpoint

CREATE TRIGGER "document_lines_within_count_changed" AFTER UPDATE ON "document_lines"
	REFERENCING NEW TABLE AS added
	FOR EACH STATEMENT EXECUTE FUNCTION "document_lines_within_count"();
