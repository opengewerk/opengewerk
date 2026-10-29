-- Lets a signature fix any draft again, back to how 0015 wrote the function.
--
-- Nothing is written and no row is touched. A document signed while 0090 was
-- in place stays signed.
--
-- Run as the superuser, like every rollback.
CREATE OR REPLACE FUNCTION "sign_document"() RETURNS trigger AS $$
BEGIN
	UPDATE "documents" SET "status" = 'signed'
		WHERE "id" = new."document_id" AND "status" = 'draft' AND "deleted_at" IS NULL;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Unterschrieben wird nur ein Entwurf, und dieser Beleg ist keiner mehr.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$ LANGUAGE plpgsql;
