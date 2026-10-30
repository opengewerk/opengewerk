-- Takes back 0099 (#463). The markups and what the articles said about their
-- selling prices go with their tables, the main supplier with its column; the
-- selling prices that came from them stay, as prices entered from a day on.
-- The setting `material.markup_basis_points` stays in its enum, as a value
-- cannot be taken out of one (0066); its rows go, so that nothing reads one.
DROP TRIGGER "main_supplier_follows" ON "supplier_articles";--> statement-breakpoint
DROP FUNCTION "main_supplier_follows"();--> statement-breakpoint
DROP TRIGGER "first_supplier_is_main" ON "supplier_articles";--> statement-breakpoint
DROP FUNCTION "first_supplier_is_main"();--> statement-breakpoint
DROP INDEX "supplier_articles_one_main";--> statement-breakpoint
ALTER TABLE "supplier_articles" DROP COLUMN "main";--> statement-breakpoint
DROP TABLE "article_markups";--> statement-breakpoint
DROP TABLE "supplier_markups";--> statement-breakpoint
ALTER TABLE "tenant_parameters" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "tenant_parameters" WHERE "key" = 'material.markup_basis_points';--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_parameters" FORCE ROW LEVEL SECURITY;
