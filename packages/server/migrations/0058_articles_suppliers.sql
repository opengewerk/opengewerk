-- Articles and suppliers, #296. A supplier is master data like a customer
-- and travels to every device; its people are contacts, which may now hang on
-- a supplier as well, one parent of three. An article has its selling prices
-- from a day on as rows of their own; which supplier sells it under which
-- number, and at which purchase price, is kept in two tables without sync
-- columns, since the pull sends every table that has a change sequence to
-- every device, and a purchase price is for the owner and the office only.
--
-- Everything down to the policies comes from the schema. What follows is
-- written by hand: FORCE, the grants, the audit and sync triggers, and the
-- trigger that lets the parts of a deleted article or supplier go with it:
-- selling prices and contacts are marked, the rows kept at the routes are
-- removed, and the change log keeps what was removed. No row of an existing
-- table changes; the contacts only get a column and a wider check.
--
-- The application may change an article and a supplier as the routes do, may
-- mark a selling price deleted but never change one, and may change the
-- number a supplier gives an article; a purchase price is inserted and
-- removed, never changed.

CREATE TABLE "article_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "article_prices_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "article_prices_in_range" CHECK ("article_prices"."unit_price_cents" between 0 and 99999999)
);
--> statement-breakpoint
ALTER TABLE "article_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"designation" text NOT NULL,
	"description" text,
	"ean" text,
	"unit" "line_unit" NOT NULL,
	"group_of_goods" text,
	"frequent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "articles_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "articles_number_fits" CHECK (char_length("articles"."number") between 1 and 40),
	CONSTRAINT "articles_designation_fits" CHECK (char_length("articles"."designation") between 1 and 200),
	CONSTRAINT "articles_group_fits" CHECK (char_length("articles"."group_of_goods") <= 80),
	CONSTRAINT "articles_ean_shaped" CHECK ("articles"."ean" ~ '^([0-9]{8}|[0-9]{13})$')
);
--> statement-breakpoint
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_article_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_prices_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_prices_in_range" CHECK ("purchase_prices"."unit_price_cents" between 0 and 99999999)
);
--> statement-breakpoint
ALTER TABLE "purchase_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_articles_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_articles_number_fits" CHECK (char_length("supplier_articles"."supplier_number") <= 40)
);
--> statement-breakpoint
ALTER TABLE "supplier_articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"customer_number" text,
	"email" text,
	"phone" text,
	"street" text,
	"house_number" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "suppliers_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_country_code" CHECK ("suppliers"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "suppliers_name_fits" CHECK (char_length("suppliers"."name") between 1 and 200),
	CONSTRAINT "suppliers_customer_number_fits" CHECK (char_length("suppliers"."customer_number") <= 40)
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_belong_to_customer_or_site";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "article_prices" ADD CONSTRAINT "article_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_prices" ADD CONSTRAINT "article_prices_article_in_tenant" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_prices" ADD CONSTRAINT "purchase_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_prices" ADD CONSTRAINT "purchase_prices_supplier_article_in_tenant" FOREIGN KEY ("tenant_id","supplier_article_id") REFERENCES "public"."supplier_articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_article_in_tenant" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_supplier_in_tenant" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_prices_one_a_day" ON "article_prices" USING btree ("tenant_id","article_id","valid_from") WHERE "article_prices"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_number_once" ON "articles" USING btree ("tenant_id",lower("number")) WHERE "articles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "articles_group_idx" ON "articles" USING btree ("tenant_id","group_of_goods");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_prices_one_a_day" ON "purchase_prices" USING btree ("tenant_id","supplier_article_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_articles_once" ON "supplier_articles" USING btree ("tenant_id","article_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_articles_supplier_idx" ON "supplier_articles" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_supplier_in_tenant" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_supplier_idx" ON "contacts" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_belong_to_one_parent" CHECK (num_nonnulls("contacts"."customer_id", "contacts"."site_id", "contacts"."supplier_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "article_prices" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("article_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("article_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "articles" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_prices" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("purchase_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("purchase_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "supplier_articles" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("supplier_articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("supplier_articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "suppliers" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("suppliers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("suppliers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "suppliers" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "articles" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "article_prices" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("deleted_at") ON "article_prices" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "supplier_articles" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("supplier_number", "updated_at") ON "supplier_articles" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "purchase_prices" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "suppliers"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "articles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "article_prices"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "supplier_articles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "purchase_prices"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "suppliers"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "articles"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "article_prices"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE FUNCTION "material_follows_deletion"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	-- Every statement names the business as well, like the triggers of 0030
	-- and 0054: the keys already bind these rows to it, and the condition
	-- still holds should a later migration lift FORCE on one of the tables.
	IF tg_table_name = 'articles' THEN
		UPDATE public.article_prices SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND article_id = new.id AND deleted_at IS NULL;
		DELETE FROM public.supplier_articles
		 WHERE tenant_id = new.tenant_id AND article_id = new.id;
	ELSIF tg_table_name = 'suppliers' THEN
		DELETE FROM public.supplier_articles
		 WHERE tenant_id = new.tenant_id AND supplier_id = new.id;
		UPDATE public.contacts SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND supplier_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "material_follows_deletion" AFTER UPDATE OF "deleted_at" ON "articles"
	FOR EACH ROW EXECUTE FUNCTION "material_follows_deletion"();--> statement-breakpoint
CREATE TRIGGER "material_follows_deletion" AFTER UPDATE OF "deleted_at" ON "suppliers"
	FOR EACH ROW EXECUTE FUNCTION "material_follows_deletion"();
