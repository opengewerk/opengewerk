-- Takes back 0105 (#299). A delivery note is signed no more, nor booked when
-- it is issued; what was booked stays booked. A delivery note that names a
-- store keeps it: a fixed document is not changed, so the narrower check comes
-- back unvalidated and holds for every row written from now on.
DROP TRIGGER "documents_book_a_delivery_note" ON "documents";--> statement-breakpoint
DROP FUNCTION "book_delivered_material"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "book_report_material"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "stock_movements"
		("tenant_id", "store_id", "article_id", "kind", "quantity_milli", "job_id", "document_line_id", "booked_by")
	SELECT l."tenant_id", d."store_id", l."article_id", 'withdrawal', l."quantity_milli", d."job_id", l."id",
	       nullif(current_setting('app.user_id', true), '')
	  FROM "documents" d
	  JOIN "document_lines" l ON l."document_id" = d."id" AND l."deleted_at" IS NULL
	  JOIN "articles" a ON a."id" = l."article_id"
	 WHERE d."id" = new."document_id"
	   AND d."kind" = 'time_and_material_report'
	   AND d."store_id" IS NOT NULL
	   AND d."job_id" IS NOT NULL
	   AND l."kind" = 'item'
	   AND l."quantity_milli" > 0
	   AND l."unit"::text = a."unit"
	   AND a."unit" IN ('piece', 'metre', 'square_metre', 'kilogram', 'litre', 'package')
	ON CONFLICT DO NOTHING;

	RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP FUNCTION "book_material_of"(uuid);--> statement-breakpoint
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
$$ LANGUAGE plpgsql;--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_store_of_a_report";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_store_of_a_report" CHECK ("documents"."store_id" is null or "documents"."kind" = 'time_and_material_report') NOT VALID;
