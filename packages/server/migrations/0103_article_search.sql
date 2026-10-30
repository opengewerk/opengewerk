-- The search over a catalogue the size of a wholesaler's (#461). Measured on
-- 30.10.2026 with 700,000 articles of one business, as the application: a
-- search took 1.35 s, because each one read every article, and for each the
-- links of its suppliers.
--
-- **Why a table of its own, outside FORCE**: under row level security
-- PostgreSQL uses an index only for a comparison it knows to be leakproof, so
-- that a condition of the query cannot see a row before the policy has ruled
-- on it. LIKE and the trigram operators are not marked so, and only a
-- superuser may mark them, which a migration is not. A trigram index on
-- `articles` itself would never be used. Decided by Moritz on 30.10.2026, with
-- the reasons in ADR 0015: one derived table that the application has no right
-- on at all, row level security on but not forced, so that its owner reads it
-- with the index. It is written only by the two triggers below and read only
-- through `article_search_hits`, which asks for the tenant of the transaction
-- itself. Measured the same way at the route: 10 to 110 ms for a search.
--
-- **What it holds**: a row for each article that is not deleted, with its
-- number, name and EAN, and one for each supplier's number of an article, all
-- in lower case. The supplier's name stays out: renaming a supplier would
-- rewrite every row of its catalogue, and the list asks the few suppliers
-- themselves.
--
-- **The triggers** run once a statement, with the rows the statement wrote,
-- and as the owner. They read only those rows, never `articles` or
-- `supplier_articles` themselves: the policies there are the application's,
-- and the owner finds no row under FORCE. An update of an article is written
-- through only where its number, name, EAN or deletion changed, since the
-- stamp of the sync and the end of an import touch every row they wrote. A row
-- removed from `articles` or `supplier_articles` takes its own along through
-- the foreign key.
--
-- **`articles_number_order` and `articles_designation_order`**: the list in
-- its two orders, page by page from the index alone. The column itself comes
-- last, so that PostgreSQL need not visit the table for each row an offset
-- passes over: the last page by name sorted the whole catalogue, 1.6 s, and
-- by number visited every row, 0.3 s; from these indexes both take 0.08 s.
--
-- The table, its keys, indexes and policy come from the schema; the extension,
-- the functions, the triggers and the rows that exist already are written by
-- hand. Row level security is lifted on `articles` and `supplier_articles` for
-- the copy: an installation migrates as the owner, and under FORCE the owner
-- finds no row (0029, 0095).
--
-- **Fits the version before it**: it reads neither the table nor the index,
-- and the triggers only add to what its writes do.
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";--> statement-breakpoint
CREATE TABLE "article_search" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"supplier_article_id" uuid,
	"text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_search" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_search" ADD CONSTRAINT "article_search_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_search" ADD CONSTRAINT "article_search_article_in_tenant" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_search" ADD CONSTRAINT "article_search_link_in_tenant" FOREIGN KEY ("tenant_id","supplier_article_id") REFERENCES "public"."supplier_articles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_search_text" ON "article_search" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "article_search_article" ON "article_search" USING btree ("tenant_id","article_id");--> statement-breakpoint
CREATE INDEX "article_search_link" ON "article_search" USING btree ("tenant_id","supplier_article_id");--> statement-breakpoint
CREATE INDEX "articles_number_order" ON "articles" USING btree ("tenant_id",lower("number"),"id","number") WHERE "articles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "articles_designation_order" ON "articles" USING btree ("tenant_id",lower("designation"),"id","designation") WHERE "articles"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "article_search" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("article_search"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("article_search"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- No FORCE and no grant, on purpose (see above). The policy stays for the day
-- somebody grants the application a right after all: it would still see only
-- its own tenant.
REVOKE ALL ON "article_search" FROM PUBLIC;--> statement-breakpoint

-- An article's own row: written when it is made, rewritten when its number,
-- name or EAN changes, removed when it is marked deleted and back when the
-- mark goes.
CREATE FUNCTION "article_search_of_articles"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO public.article_search (id, tenant_id, article_id, text)
		SELECT n.id, n.tenant_id, n.id, lower(n.number || ' ' || n.designation || coalesce(' ' || n.ean, ''))
		  FROM new_rows n
		 WHERE n.deleted_at IS NULL;

		RETURN NULL;
	END IF;

	DELETE FROM public.article_search s
	 USING new_rows n
	 WHERE s.id = n.id AND n.deleted_at IS NOT NULL;

	INSERT INTO public.article_search (id, tenant_id, article_id, text)
	SELECT n.id, n.tenant_id, n.id, lower(n.number || ' ' || n.designation || coalesce(' ' || n.ean, ''))
	  FROM new_rows n
	  JOIN old_rows o ON o.id = n.id
	 WHERE n.deleted_at IS NULL
	   AND (o.deleted_at IS NOT NULL
	        OR (n.number, n.designation, n.ean) IS DISTINCT FROM (o.number, o.designation, o.ean))
	ON CONFLICT (id) DO UPDATE SET text = excluded.text;

	RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "article_search_of_articles"() FROM PUBLIC;--> statement-breakpoint

-- A supplier's number of an article: written with the link, rewritten when
-- the number or the article changes, removed when the number goes.
CREATE FUNCTION "article_search_of_supplier_articles"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		DELETE FROM public.article_search s
		 USING new_rows n
		 WHERE s.id = n.id AND coalesce(n.supplier_number, '') = '';
	END IF;

	INSERT INTO public.article_search (id, tenant_id, article_id, supplier_article_id, text)
	SELECT n.id, n.tenant_id, n.article_id, n.id, lower(n.supplier_number)
	  FROM new_rows n
	 WHERE coalesce(n.supplier_number, '') <> ''
	ON CONFLICT (id) DO UPDATE SET article_id = excluded.article_id, text = excluded.text
	 WHERE (article_search.article_id, article_search.text) IS DISTINCT FROM (excluded.article_id, excluded.text);

	RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "article_search_of_supplier_articles"() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER "article_search_on_insert" AFTER INSERT ON "articles"
	REFERENCING NEW TABLE AS new_rows
	FOR EACH STATEMENT EXECUTE FUNCTION "article_search_of_articles"();--> statement-breakpoint
CREATE TRIGGER "article_search_on_update" AFTER UPDATE ON "articles"
	REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
	FOR EACH STATEMENT EXECUTE FUNCTION "article_search_of_articles"();--> statement-breakpoint
CREATE TRIGGER "article_search_on_insert" AFTER INSERT ON "supplier_articles"
	REFERENCING NEW TABLE AS new_rows
	FOR EACH STATEMENT EXECUTE FUNCTION "article_search_of_supplier_articles"();--> statement-breakpoint
CREATE TRIGGER "article_search_on_update" AFTER UPDATE ON "supplier_articles"
	REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
	FOR EACH STATEMENT EXECUTE FUNCTION "article_search_of_supplier_articles"();--> statement-breakpoint

-- The search itself: the articles of the tenant of the transaction whose row
-- holds the pattern, a LIKE pattern the route has escaped. Without a tenant it
-- finds nothing. Runs as the owner, so that the trigram index is used, and
-- that is also why the tenant is asked here and not left to a policy.
CREATE FUNCTION "article_search_hits"(pattern text) RETURNS SETOF uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	ROWS 100
AS $$
	SELECT DISTINCT s.article_id
	  FROM public.article_search s
	 WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	   AND s.text LIKE lower(pattern)
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "article_search_hits"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "article_search_hits"(text) TO "opengewerk_app";--> statement-breakpoint

-- What exists already, copied once.
ALTER TABLE "articles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_articles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "article_search" ("id", "tenant_id", "article_id", "text")
SELECT "id", "tenant_id", "id", lower("number" || ' ' || "designation" || coalesce(' ' || "ean", ''))
  FROM "articles"
 WHERE "deleted_at" IS NULL;--> statement-breakpoint
INSERT INTO "article_search" ("id", "tenant_id", "article_id", "supplier_article_id", "text")
SELECT "id", "tenant_id", "article_id", "id", lower("supplier_number")
  FROM "supplier_articles"
 WHERE coalesce("supplier_number", '') <> '';--> statement-breakpoint
ALTER TABLE "supplier_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;
