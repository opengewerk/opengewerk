-- The stock (#298, Feature-Gliederung v2.39), with the factory of the
-- foundation (ADR 0011): the stores of the business, its stores and its
-- service vehicles, what a store keeps of an article (where it lies, its
-- minimum) and the bookings the stock is made of.
--
-- **`articles` and `suppliers`** are made by the same factory from now on,
-- with this application's columns as its own. Their rows stay as they are;
-- what changes is what the factory holds beside them: the unit of an article
-- is text with a check of the units of a position instead of the enum
-- `line_unit`, which the lines keep, a description has the bound of the
-- stock, 2000 characters, and the check of a supplier's customer number says
-- the same in the factory's words. A description longer than that was never
-- possible in a form; one that came in another way is cut to it before the
-- check, as a change in the log.
--
-- **The new tables** carry the columns of the sync and travel to the devices
-- the way the code says. A booking is written once: the application may read
-- and add one, never change or remove it. A booking names the line of a
-- report it books, once, and the job it was for.
--
-- Everything down to the policies comes from the schema; the cast of the
-- unit, the cut of the descriptions, FORCE, the grants and the triggers are
-- written by hand. Row level security is lifted on `articles` for the cut: an
-- installation migrates as the owner, and under FORCE the owner finds no row
-- (0029, 0095).
--
-- **Fits the version before it**: it reads neither the new tables nor the
-- new checks, and its forms already keep a unit of the list and a description
-- far below the bound.
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity_milli" integer NOT NULL,
	"supplier_id" uuid,
	"counterpart_store_id" uuid,
	"reason" text,
	"booked_by" text,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"job_id" uuid,
	"document_line_id" uuid,
	CONSTRAINT "stock_movements_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_movements_kind_known" CHECK ("stock_movements"."kind" in ('receipt', 'count', 'withdrawal', 'transfer_out', 'transfer_in', 'write_off')),
	CONSTRAINT "stock_movements_quantity_from_zero" CHECK ("stock_movements"."quantity_milli" between 0 and 1000000000),
	CONSTRAINT "stock_movements_moves_something" CHECK ("stock_movements"."kind" = 'count' or "stock_movements"."quantity_milli" > 0),
	CONSTRAINT "stock_movements_count_with_a_reason" CHECK ("stock_movements"."kind" <> 'count' or "stock_movements"."reason" is not null),
	CONSTRAINT "stock_movements_write_off_with_a_reason" CHECK ("stock_movements"."kind" <> 'write_off' or "stock_movements"."reason" is not null),
	CONSTRAINT "stock_movements_reason_fits" CHECK ("stock_movements"."reason" is null or char_length("stock_movements"."reason") <= 500),
	CONSTRAINT "stock_movements_supplier_at_a_receipt" CHECK ("stock_movements"."supplier_id" is null or "stock_movements"."kind" = 'receipt'),
	CONSTRAINT "stock_movements_transfer_names_its_store" CHECK (("stock_movements"."kind" in ('transfer_out', 'transfer_in')) = ("stock_movements"."counterpart_store_id" is not null)),
	CONSTRAINT "stock_movements_transfer_elsewhere" CHECK ("stock_movements"."counterpart_store_id" is null or "stock_movements"."counterpart_store_id" <> "stock_movements"."store_id"),
	CONSTRAINT "stock_movements_job_at_a_receipt_or_withdrawal" CHECK ("stock_movements"."job_id" is null or "stock_movements"."kind" in ('receipt', 'withdrawal')),
	CONSTRAINT "stock_movements_line_at_a_withdrawal_for_its_job" CHECK ("stock_movements"."document_line_id" is null or ("stock_movements"."kind" = 'withdrawal' and "stock_movements"."job_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"bin" text,
	"minimum_milli" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "store_articles_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "store_articles_once" UNIQUE("tenant_id","store_id","article_id"),
	CONSTRAINT "store_articles_bin_fits" CHECK ("store_articles"."bin" is null or char_length("store_articles"."bin") <= 200),
	CONSTRAINT "store_articles_minimum_from_zero" CHECK ("store_articles"."minimum_milli" is null or "store_articles"."minimum_milli" between 0 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "store_articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"vehicle" boolean DEFAULT false NOT NULL,
	"plate" text,
	CONSTRAINT "stores_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stores_name_fits" CHECK (char_length("stores"."name") between 1 and 120),
	CONSTRAINT "stores_location_fits" CHECK ("stores"."location" is null or char_length("stores"."location") <= 200),
	CONSTRAINT "stores_plate_fits" CHECK ("stores"."plate" is null or char_length("stores"."plate") between 1 and 12),
	CONSTRAINT "stores_plate_of_a_vehicle" CHECK ("stores"."plate" is null or "stores"."vehicle")
);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_customer_number_fits";--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "unit" SET DATA TYPE text USING "unit"::text;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_in_a_store_here" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_of_an_article_here" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_a_supplier_here" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_with_a_store_here" FOREIGN KEY ("tenant_id","counterpart_store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_by_somebody_here" FOREIGN KEY ("tenant_id","booked_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_at_a_job_here" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_of_a_line_here" FOREIGN KEY ("tenant_id","document_line_id") REFERENCES "public"."document_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_articles" ADD CONSTRAINT "store_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_articles" ADD CONSTRAINT "store_articles_in_a_store_here" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_articles" ADD CONSTRAINT "store_articles_of_an_article_here" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "store_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_store_in_tenant" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_store_of_a_report" CHECK ("documents"."store_id" is null or "documents"."kind" = 'time_and_material_report');--> statement-breakpoint
CREATE INDEX "stock_movements_of_an_article_idx" ON "stock_movements" USING btree ("tenant_id","store_id","article_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_book_a_line_once" ON "stock_movements" USING btree ("tenant_id","document_line_id") WHERE "stock_movements"."document_line_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_at_a_job_idx" ON "stock_movements" USING btree ("tenant_id","job_id") WHERE "stock_movements"."job_id" is not null;--> statement-breakpoint
ALTER TABLE "articles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "articles" SET "description" = left("description", 2000) WHERE char_length("description") > 2000;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_description_fits" CHECK ("articles"."description" is null or char_length("articles"."description") <= 2000);--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_unit_known" CHECK ("articles"."unit" in ('piece', 'hour', 'day', 'metre', 'square_metre', 'cubic_metre', 'kilogram', 'litre', 'package', 'flat_rate'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_customer_number_fits" CHECK ("suppliers"."customer_number" is null or char_length("suppliers"."customer_number") <= 40);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_movements" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("stock_movements"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("stock_movements"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_articles" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("store_articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("store_articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stores" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("stores"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("stores"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stores" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "store_articles" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "stock_movements" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "stores"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "store_articles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "stores"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "store_articles"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
-- What a report took out of its store (#298, decided on 31.10.2026): booked
-- when the customer signs, once for each line of an article the store can
-- keep and in the unit the article counts in, as a withdrawal for the job of
-- the report. Beside `sign_document` of 0015, on the same row of the
-- signature, so that a report signed on site without a network is booked
-- when its signature arrives. Run as whoever signs, under the policies, and
-- by the account the transaction names. A report without a store takes
-- nothing out, and a line already booked is not booked twice.
CREATE FUNCTION "book_report_material"() RETURNS trigger AS $$
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
CREATE TRIGGER "document_signatures_book_the_material" AFTER INSERT ON "document_signatures"
	FOR EACH ROW EXECUTE FUNCTION "book_report_material"();--> statement-breakpoint
-- The new right "Lager buchen" for the owner and the office of every business
-- there is, as their roles in the code have it from now on.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'stock.write')
 WHERE "key" IN ('owner', 'office') AND NOT ('stock.write' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
