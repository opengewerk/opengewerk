-- Takes back 0104 (#298). The stores, what they keep and their bookings go;
-- articles and suppliers keep their rows and lose the checks of the factory,
-- and the unit of an article is the enum of a position again. A description
-- cut to 2000 characters stays cut, and the right "Lager buchen" stays in the
-- roles that have it, where it asks for nothing any more.
DROP TRIGGER "document_signatures_book_the_material" ON "document_signatures";--> statement-breakpoint
DROP FUNCTION "book_report_material"();--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "store_id";--> statement-breakpoint
DROP TABLE "stock_movements";--> statement-breakpoint
DROP TABLE "store_articles";--> statement-breakpoint
DROP TABLE "stores";--> statement-breakpoint
ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_tenant_id_key";--> statement-breakpoint
ALTER TABLE "articles" DROP CONSTRAINT "articles_description_fits";--> statement-breakpoint
ALTER TABLE "articles" DROP CONSTRAINT "articles_unit_known";--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "unit" SET DATA TYPE "public"."line_unit" USING "unit"::"public"."line_unit";--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_customer_number_fits";--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_customer_number_fits" CHECK (char_length("suppliers"."customer_number") <= 40);
