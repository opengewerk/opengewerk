-- The selling price from the purchase price and a markup (#463), decided on
-- 28.09.2026: an article's selling price is its main supplier's purchase price
-- with a markup, the narrowest that is set.
--
-- **The markup of the business** is a setting from a day on,
-- `material.markup_basis_points` in hundredths of a percent.
--
-- **`supplier_markups` and `article_markups`**: a supplier's own markup, and
-- what an article says about its selling price, fixed or with a markup of its
-- own. Tables of their own and not columns of `suppliers` and `articles`,
-- which are on every device: like the purchase prices they stay at the routes
-- of the office. Everything down to the policies comes from the schema; FORCE,
-- the grants and the change log are written by hand.
--
-- **`supplier_articles.main`**: the main supplier of an article, whose
-- purchase price makes the selling price. One per article that has a supplier
-- at all, kept by two triggers rather than by whoever writes a link: the first
-- link of an article is the main one, and when the main one goes, the oldest
-- left takes its place. The links there are get it now, the oldest of each
-- article, which is the supplier that brought it first.
--
-- **Fixed prices**: an article whose latest selling price was entered by hand
-- keeps its prices, fixed, until somebody changes that (decided on
-- 28.09.2026); one whose latest came from an import follows the purchase
-- price from now on.
--
-- Row level security is lifted on the tables the two statements read and
-- write: an installation migrates as the owner, and under FORCE the owner
-- finds no row and says nothing (0029, 0095). The change log names the
-- migration as the reason.
--
-- **Fits the version before it**: it reads none of the new tables and never
-- sets `main`; a link it writes is made main by the trigger where the article
-- has none, and its selling prices are entered by hand as before.
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'material.markup_basis_points';--> statement-breakpoint
CREATE TABLE "article_markups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"fixed" boolean NOT NULL,
	"basis_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_markups_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "article_markups_once" UNIQUE("tenant_id","article_id"),
	CONSTRAINT "article_markups_fixed_or_own" CHECK ("article_markups"."fixed" = ("article_markups"."basis_points" is null)),
	CONSTRAINT "article_markups_in_range" CHECK ("article_markups"."basis_points" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "article_markups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_markups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"basis_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_markups_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_markups_once" UNIQUE("tenant_id","supplier_id"),
	CONSTRAINT "supplier_markups_in_range" CHECK ("supplier_markups"."basis_points" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "supplier_markups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD COLUMN "main" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "article_markups" ADD CONSTRAINT "article_markups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_markups" ADD CONSTRAINT "article_markups_article_in_tenant" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_markups" ADD CONSTRAINT "supplier_markups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_markups" ADD CONSTRAINT "supplier_markups_supplier_in_tenant" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_articles_one_main" ON "supplier_articles" USING btree ("tenant_id","article_id") WHERE "supplier_articles"."main";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "article_markups" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("article_markups"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("article_markups"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "supplier_markups" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("supplier_markups"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("supplier_markups"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "supplier_markups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_markups" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "article_markups" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("main") ON "supplier_articles" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "supplier_markups"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "article_markups"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- The first link of an article is its main one.
CREATE FUNCTION "first_supplier_is_main"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF NOT new.main AND NOT EXISTS (
		SELECT 1 FROM public.supplier_articles
		 WHERE tenant_id = new.tenant_id AND article_id = new.article_id AND main
	) THEN
		new.main := true;
	END IF;
	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "first_supplier_is_main" BEFORE INSERT ON "supplier_articles"
	FOR EACH ROW EXECUTE FUNCTION "first_supplier_is_main"();--> statement-breakpoint

-- When the main link goes, the oldest left of the article takes its place.
CREATE FUNCTION "main_supplier_follows"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.main THEN
		UPDATE public.supplier_articles SET main = true, updated_at = now()
		 WHERE id = (
			SELECT id FROM public.supplier_articles
			 WHERE tenant_id = old.tenant_id AND article_id = old.article_id
			 ORDER BY created_at, id
			 LIMIT 1
		 );
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "main_supplier_follows" AFTER DELETE ON "supplier_articles"
	FOR EACH ROW EXECUTE FUNCTION "main_supplier_follows"();--> statement-breakpoint

ALTER TABLE "articles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_prices" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "supplier_articles" SET "main" = true
 WHERE "id" IN (
	SELECT DISTINCT ON ("tenant_id", "article_id") "id"
	  FROM "supplier_articles"
	 ORDER BY "tenant_id", "article_id", "created_at", "id"
 );--> statement-breakpoint
INSERT INTO "article_markups" ("tenant_id", "article_id", "fixed")
SELECT "latest"."tenant_id", "latest"."article_id", true
  FROM (
	SELECT DISTINCT ON ("p"."tenant_id", "p"."article_id") "p"."tenant_id", "p"."article_id", "p"."import_id"
	  FROM "article_prices" "p"
	  JOIN "articles" "a" ON "a"."tenant_id" = "p"."tenant_id" AND "a"."id" = "p"."article_id"
	 WHERE "p"."deleted_at" IS NULL AND "a"."deleted_at" IS NULL
	 ORDER BY "p"."tenant_id", "p"."article_id", "p"."valid_from" DESC
  ) AS "latest"
 WHERE "latest"."import_id" IS NULL;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "supplier_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_markups" FORCE ROW LEVEL SECURITY;
