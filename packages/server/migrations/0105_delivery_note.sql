-- The delivery note (#299, Feature-Gliederung v2.40, decided on 31.10.2026):
-- one to an order confirmation, made in the office, delivered from a store
-- chosen on it. Its recipient may sign it on the device and need not.
--
-- A delivery note takes material out of a store like a report.
ALTER TABLE "documents" DROP CONSTRAINT "documents_store_of_a_report";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_store_of_a_report" CHECK ("documents"."store_id" is null or "documents"."kind" in ('time_and_material_report', 'delivery_note'));--> statement-breakpoint
-- A signature fixes a draft report that continues no chain (0090) and now a
-- draft delivery note as well, which always hangs at its order confirmation.
-- Any other document is refused with OG001, as before.
CREATE OR REPLACE FUNCTION "sign_document"() RETURNS trigger AS $$
BEGIN
	UPDATE "documents" SET "status" = 'signed'
		WHERE "id" = new."document_id" AND "status" = 'draft' AND "deleted_at" IS NULL
			AND (("kind" = 'time_and_material_report' AND "predecessor_document_id" IS NULL)
				OR "kind" = 'delivery_note');

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Unterschrieben wird nur ein Regiebericht im Entwurf, der an keinem anderen Beleg hängt, oder ein Lieferschein im Entwurf.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- What a report or a delivery note takes out of its store, once for each line
-- of an article a store can keep, in the unit the article counts in, as a
-- withdrawal for the job of the document (0104). Run as whoever fixes the
-- document, under the policies. A document without a store takes nothing out,
-- and a line already booked is not booked twice: the key on
-- `document_line_id` holds that, whichever of the two ways in comes second.
CREATE FUNCTION "book_material_of"(document uuid) RETURNS void AS $$
	INSERT INTO "stock_movements"
		("tenant_id", "store_id", "article_id", "kind", "quantity_milli", "job_id", "document_line_id", "booked_by")
	SELECT l."tenant_id", d."store_id", l."article_id", 'withdrawal', l."quantity_milli", d."job_id", l."id",
	       nullif(current_setting('app.user_id', true), '')
	  FROM "documents" d
	  JOIN "document_lines" l ON l."document_id" = d."id" AND l."deleted_at" IS NULL
	  JOIN "articles" a ON a."id" = l."article_id"
	 WHERE d."id" = document
	   AND d."kind" IN ('time_and_material_report', 'delivery_note')
	   AND d."store_id" IS NOT NULL
	   AND d."job_id" IS NOT NULL
	   AND l."kind" = 'item'
	   AND l."quantity_milli" > 0
	   AND l."unit"::text = a."unit"
	   AND a."unit" IN ('piece', 'metre', 'square_metre', 'kilogram', 'litre', 'package')
	ON CONFLICT DO NOTHING;
$$ LANGUAGE sql;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "book_material_of"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "book_material_of"(uuid) TO "opengewerk_app";--> statement-breakpoint
-- At the signature, as since 0104, now for a delivery note as well.
CREATE OR REPLACE FUNCTION "book_report_material"() RETURNS trigger AS $$
BEGIN
	PERFORM "book_material_of"(new."document_id");

	RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- A delivery note nobody signed is fixed by issuing it, and that books it.
-- One that was signed was booked then, and issuing it only gives it its
-- number.
CREATE FUNCTION "book_delivered_material"() RETURNS trigger AS $$
BEGIN
	PERFORM "book_material_of"(new."id");

	RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "documents_book_a_delivery_note" AFTER UPDATE OF "status" ON "documents"
	FOR EACH ROW WHEN (new."kind" = 'delivery_note' AND old."status" = 'draft' AND new."status" = 'issued')
	EXECUTE FUNCTION "book_delivered_material"();
