-- Imports from DATANORM, #297. An import keeps the files of one supplier, what
-- reading them found and whether it was taken over; the rows it writes name it
-- in `import_id`. A supplier gets a short code for article numbers that are
-- taken, a link to a supplier its discount group, and the supplier's list
-- price comes as a table of its own, beside the purchase prices.
--
-- Everything down to the policies comes from the schema. What follows is
-- written by hand: FORCE, the grants, the audit trigger of the two new tables,
-- and what lets a takeover write tens of thousands of articles without
-- holding the business up.
--
-- The change log keeps an import as one record, the changes of its row, and
-- not one per field of every article (decided on 28.09.2026): field by field,
-- a catalogue of 100,000 articles is some 2.9 million entries and minutes in
-- which the chain, and with it every change in the business, waits. So while
-- an import is taken over, and only then, the audit trigger of the article
-- tables passes over its rows, and so does the stamp of the sync on the two
-- synced ones. The import writes the five columns of the stamp itself, the
-- number as a placeholder below zero, and at the very end takes a run of
-- numbers of the counter at once and puts them in place. The counter row is
-- locked from the first number a transaction takes until it commits; taken at
-- the end, it waits for the renumbering and not for the whole takeover, and
-- with it every exchange of a device. What decides "only then" is
-- `article_import_writing()`: the transaction has to name an import of its
-- business that its own row, which the log watches, says is applying.

CREATE TYPE "public"."article_import_status" AS ENUM('reading', 'ready', 'applying', 'applied', 'failed', 'discarded');--> statement-breakpoint
CREATE TABLE "article_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "article_import_status" DEFAULT 'reading' NOT NULL,
	"files" jsonb NOT NULL,
	"charset" text,
	"valid_from" date NOT NULL,
	"list_as_selling" boolean DEFAULT true NOT NULL,
	"summary" jsonb,
	"problem" text,
	"created_by" text,
	"applied_by" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_imports_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "article_imports_charset_known" CHECK ("article_imports"."charset" in ('utf-8', 'cp850', 'windows-1252'))
);
--> statement-breakpoint
ALTER TABLE "article_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "list_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_article_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"price_base" integer DEFAULT 1 NOT NULL,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_prices_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "list_prices_in_range" CHECK ("list_prices"."unit_price_cents" between 0 and 99999999),
	CONSTRAINT "list_prices_price_base_known" CHECK ("list_prices"."price_base" in (1, 10, 100, 1000))
);
--> statement-breakpoint
ALTER TABLE "list_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_prices" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_prices" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD COLUMN "discount_group" text;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "short_code" text;--> statement-breakpoint
ALTER TABLE "article_imports" ADD CONSTRAINT "article_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_imports" ADD CONSTRAINT "article_imports_supplier_in_tenant" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_prices" ADD CONSTRAINT "list_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_prices" ADD CONSTRAINT "list_prices_supplier_article_in_tenant" FOREIGN KEY ("tenant_id","supplier_article_id") REFERENCES "public"."supplier_articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_prices" ADD CONSTRAINT "list_prices_import_in_tenant" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."article_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_imports_one_running" ON "article_imports" USING btree ("tenant_id") WHERE "article_imports"."status" in ('reading', 'applying');--> statement-breakpoint
CREATE UNIQUE INDEX "list_prices_one_a_day" ON "list_prices" USING btree ("tenant_id","supplier_article_id","valid_from");--> statement-breakpoint
ALTER TABLE "article_prices" ADD CONSTRAINT "article_prices_import_in_tenant" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."article_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_import_in_tenant" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."article_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_prices" ADD CONSTRAINT "purchase_prices_import_in_tenant" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."article_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_import_in_tenant" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."article_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_ean_idx" ON "articles" USING btree ("tenant_id","ean") WHERE "articles"."ean" is not null and "articles"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_discount_group_fits" CHECK (char_length("supplier_articles"."discount_group") <= 20);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_short_code_shaped" CHECK ("suppliers"."short_code" ~ '^[A-ZÄÖÜ0-9]{1,8}$');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "article_imports" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("article_imports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("article_imports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "article_imports" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "list_prices" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("list_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("list_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "article_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "list_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "article_imports" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "list_prices" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("discount_group", "import_id") ON "supplier_articles" TO "opengewerk_app";--> statement-breakpoint

-- The five columns of the stamp on the prices, which the application could
-- only reach through `deleted_at` so far. Outside an import this changes
-- nothing: the stamp writes all five on every update and overwrites whatever
-- was sent. Inside one it is how the import writes them itself.
GRANT UPDATE ("version", "updated_at", "updated_by", "device_id", "change_sequence") ON "article_prices" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "article_imports"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- Whether the running transaction takes over an import: it names the import in
-- `app.article_import`, and the import is one of this business and applying.
-- A name alone is not enough, and neither is an import that is only ready.
CREATE FUNCTION "article_import_writing"() RETURNS boolean
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	named text := nullif(current_setting('app.article_import', true), '');
BEGIN
	IF named IS NULL THEN
		RETURN false;
	END IF;

	RETURN EXISTS (
		SELECT 1 FROM public.article_imports
		 WHERE id = named::uuid
		   AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
		   AND status = 'applying'
	);
END;
$$;--> statement-breakpoint

-- A run of numbers of the sync counter, taken at once under the lock of the
-- counter row, which holds until the transaction ends: the rows still come out
-- in the order the transactions commit. Only for an import that is being taken
-- over, and only for the business of the session. It runs as the owner, who
-- reads `article_imports` through `readable_by_the_owner` and nothing else.
CREATE FUNCTION "reserve_sync_sequences"(amount integer) RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
	last bigint;
BEGIN
	IF NOT public.article_import_writing() OR tenant IS NULL OR amount < 1 THEN
		RAISE EXCEPTION 'Nummern des Abgleichs gibt es am Stück nur für einen Import, der übernommen wird.';
	END IF;

	INSERT INTO public.sync_sequences (tenant_id, next_value)
	VALUES (tenant, amount)
	ON CONFLICT (tenant_id) DO UPDATE SET next_value = sync_sequences.next_value + amount,
		updated_at = now()
	RETURNING next_value INTO last;

	RETURN last - amount + 1;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "reserve_sync_sequences"(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "reserve_sync_sequences"(integer) TO "opengewerk_app";--> statement-breakpoint

-- The audit trigger of the article tables, now with the condition. The rows of
-- an import are its record; every other change is logged as before.
DROP TRIGGER "audit_changes" ON "articles";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "articles"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "article_prices";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "article_prices"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "supplier_articles";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "supplier_articles"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "purchase_prices";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "purchase_prices"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "list_prices"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- The stamp of the sync on the two synced article tables, with the same
-- condition. Under its old name, which the stamp has on every synced table.
DROP TRIGGER "stamp_sync_columns" ON "articles";--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "articles"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
DROP TRIGGER "stamp_sync_columns" ON "article_prices";--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "article_prices"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "stamp_sync_columns"();
