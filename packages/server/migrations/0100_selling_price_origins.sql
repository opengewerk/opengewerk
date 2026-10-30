-- The selling prices that follow a purchase price, second part of #463.
--
-- **`article_price_origins`**: what such a selling price came from, the
-- purchase price and the markup, so that the office sees why a price is what
-- it is. Beside `article_prices` and not in it: that table is on the devices,
-- and neither figure may be. Written with the price, by an import or when a
-- markup changes, never changed; it goes with its price. Its log is the
-- import's record where an import writes it, as for the prices (0062).
--
-- **`selling_price_runs`**: the selling prices still to be worked out anew
-- after the markup of the business or of a supplier changed, one row per
-- business. The server works through it in pieces and takes it up again
-- after a restart.
--
-- Everything down to the policies comes from the schema; FORCE, the grants
-- and the change log are written by hand.
--
-- **Fits the version before it**: it reads neither table.
CREATE TABLE "article_price_origins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_price_id" uuid NOT NULL,
	"purchase_cents" integer NOT NULL,
	"basis_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_price_origins_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "article_price_origins_once" UNIQUE("tenant_id","article_price_id"),
	CONSTRAINT "article_price_origins_purchase_in_range" CHECK ("article_price_origins"."purchase_cents" between 0 and 99999999),
	CONSTRAINT "article_price_origins_in_range" CHECK ("article_price_origins"."basis_points" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "article_price_origins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "selling_price_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid,
	"from_day" date NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selling_price_runs_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "selling_price_runs_once" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "selling_price_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "article_price_origins" ADD CONSTRAINT "article_price_origins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_price_origins" ADD CONSTRAINT "article_price_origins_price_in_tenant" FOREIGN KEY ("tenant_id","article_price_id") REFERENCES "public"."article_prices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_price_runs" ADD CONSTRAINT "selling_price_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selling_price_runs" ADD CONSTRAINT "selling_price_runs_supplier_in_tenant" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "article_price_origins" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("article_price_origins"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("article_price_origins"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "selling_price_runs" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("selling_price_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("selling_price_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "article_price_origins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "selling_price_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "article_price_origins" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "selling_price_runs" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "article_price_origins"
	FOR EACH ROW WHEN (NOT public.article_import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "selling_price_runs"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
