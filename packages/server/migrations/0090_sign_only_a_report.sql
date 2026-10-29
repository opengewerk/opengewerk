-- Only a report is signed, and only one that continues no chain.
--
-- `sign_document` (0015) turned whatever draft a signature named into a signed
-- one. Signing fixes a document without a number, which every other kind
-- reaches only by being issued, and the right to sign is the right to write
-- documents (`document.write`), not the right to issue them: a signature under
-- a draft invoice, quote or order confirmation fixed it past `document.issue`.
-- The function now signs a draft of the kind a customer signs on site
-- (`signableKinds` in the domain) that names no predecessor, and refuses any
-- other with OG001, as it refused a document that was no longer a draft.
--
-- A document signed before this migration stays as it is. A version of the
-- application from before runs on unchanged: it signs reports, and those still
-- land.
CREATE OR REPLACE FUNCTION "sign_document"() RETURNS trigger AS $$
BEGIN
	UPDATE "documents" SET "status" = 'signed'
		WHERE "id" = new."document_id" AND "status" = 'draft' AND "deleted_at" IS NULL
			AND "kind" = 'time_and_material_report' AND "predecessor_document_id" IS NULL;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Unterschrieben wird nur ein Regiebericht im Entwurf, der an keinem anderen Beleg hängt.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$ LANGUAGE plpgsql;
