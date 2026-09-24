-- Rolling the country checks back to how 0037 left them. Nothing is lost:
-- the countries stay as they are, only the tables stop holding them to the
-- shape of a code.

ALTER TABLE "sites" DROP CONSTRAINT "sites_country_code";--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_country_code";
