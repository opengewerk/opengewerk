-- The metal surcharge (#462), decided on 28.09.2026: a cable's purchase price
-- holds its metal at a base, and a position puts what the supplier's metal
-- price of the document's date lies above it into its unit price.
--
-- **`supplier_article_metals`**: the metal of an article at one supplier, the
-- base in euros for 100 kg and the weight in grams for 1000 units, once per
-- link and metal. The copper that 0098 gave `supplier_articles` moves here, so
-- that aluminium entered by hand and further metals from the Z records stand
-- beside it; written by an import and by hand, so its change log keeps quiet
-- while an import writes, as for the links themselves (0062).
--
-- **`supplier_metal_prices`**: a supplier's price for a metal from a day on,
-- in cents for 100 kg, entered in the office. Inserted and removed, never
-- changed, like a purchase price.
--
-- **Markup on the surcharge**: the setting `material.markup_on_metal`, and a
-- column of its own in `supplier_markups` and `article_markups`; null leaves
-- it to the next wider one. A supplier's row may now say only that, so its
-- markup may be unset, and an article's row says something, whatever it is.
--
-- Everything down to the policies comes from the schema; FORCE, the grants,
-- the change log and the move of the copper are written by hand. Row level
-- security is lifted on the two tables of the move: an installation migrates
-- as the owner, and under FORCE the owner finds no row (0029, 0095).
--
-- **Fits the version before it**: 0098 to 0100 have not been released, so no
-- installation runs a version that reads the copper columns, and the version
-- before them reads none of the tables changed here.
CREATE TYPE "public"."metal" AS ENUM('copper', 'aluminium');--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'material.markup_on_metal';--> statement-breakpoint
CREATE TABLE "supplier_article_metals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_article_id" uuid NOT NULL,
	"metal" "metal" NOT NULL,
	"base_euros" integer NOT NULL,
	"grams_per_thousand" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_article_metals_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_article_metals_once" UNIQUE("tenant_id","supplier_article_id","metal"),
	CONSTRAINT "supplier_article_metals_in_range" CHECK ("supplier_article_metals"."base_euros" between 0 and 9999999 and "supplier_article_metals"."grams_per_thousand" between 0 and 999999900)
);--> statement-breakpoint
ALTER TABLE "supplier_article_metals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_metal_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"metal" "metal" NOT NULL,
	"valid_from" date NOT NULL,
	"price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_metal_prices_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_metal_prices_one_a_day" UNIQUE("tenant_id","supplier_id","metal","valid_from"),
	CONSTRAINT "supplier_metal_prices_in_range" CHECK ("supplier_metal_prices"."price_cents" between 1 and 99999999)
);--> statement-breakpoint
ALTER TABLE "supplier_metal_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP CONSTRAINT "supplier_articles_copper_whole";--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP CONSTRAINT "supplier_articles_copper_in_range";--> statement-breakpoint
ALTER TABLE "article_markups" DROP CONSTRAINT "article_markups_fixed_or_own";--> statement-breakpoint
ALTER TABLE "supplier_markups" ALTER COLUMN "basis_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "article_markups" ADD COLUMN "markup_on_metal" boolean;--> statement-breakpoint
ALTER TABLE "supplier_markups" ADD COLUMN "markup_on_metal" boolean;--> statement-breakpoint
ALTER TABLE "supplier_article_metals" ADD CONSTRAINT "supplier_article_metals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_article_metals" ADD CONSTRAINT "supplier_article_metals_link_in_tenant" FOREIGN KEY ("tenant_id","supplier_article_id") REFERENCES "public"."supplier_articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_metal_prices" ADD CONSTRAINT "supplier_metal_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_metal_prices" ADD CONSTRAINT "supplier_metal_prices_supplier_in_tenant" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_markups" ADD CONSTRAINT "article_markups_fixed_without_own" CHECK (not "article_markups"."fixed" or "article_markups"."basis_points" is null);--> statement-breakpoint
ALTER TABLE "article_markups" ADD CONSTRAINT "article_markups_say_something" CHECK ("article_markups"."fixed" or "article_markups"."basis_points" is not null or "article_markups"."markup_on_metal" is not null);--> statement-breakpoint
ALTER TABLE "supplier_markups" ADD CONSTRAINT "supplier_markups_say_something" CHECK ("supplier_markups"."basis_points" is not null or "supplier_markups"."markup_on_metal" is not null);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "supplier_article_metals" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("supplier_article_metals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("supplier_article_metals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "supplier_metal_prices" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("supplier_metal_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("supplier_metal_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "supplier_metal_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "supplier_article_metals" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("base_euros", "grams_per_thousand", "updated_at") ON "supplier_article_metals" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "supplier_metal_prices" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "supplier_article_metals"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "supplier_metal_prices"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
ALTER TABLE "supplier_articles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
INSERT INTO "supplier_article_metals" ("tenant_id", "supplier_article_id", "metal", "base_euros", "grams_per_thousand")
SELECT "tenant_id", "id", 'copper', "copper_base_euros", "copper_grams_per_thousand"
  FROM "supplier_articles"
 WHERE "copper_base_euros" IS NOT NULL AND "copper_grams_per_thousand" IS NOT NULL;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "supplier_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_article_metals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP COLUMN "copper_base_euros";--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP COLUMN "copper_grams_per_thousand";