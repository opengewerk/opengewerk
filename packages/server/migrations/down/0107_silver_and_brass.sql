-- Takes back 0107. Both values stay in their enum, as a value cannot be taken
-- out of one (0066); the rows that carry them go, so that nothing reads one.
ALTER TABLE "supplier_article_metals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_metal_prices" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "supplier_article_metals" WHERE "metal" IN ('silver', 'brass');--> statement-breakpoint
DELETE FROM "supplier_metal_prices" WHERE "metal" IN ('silver', 'brass');--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "supplier_metal_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_article_metals" FORCE ROW LEVEL SECURITY;
