-- The country of an address, #144: a code of ISO 3166-1, two capital letters,
-- on customers and sites.
--
-- The forms wrote DE into every customer and every site until now, and the
-- office could not choose anything else, so every row keeps to the check.
-- Should one not, because a route was fed something else by hand, the check
-- stops the update with its name, and the transaction all pending migrations
-- share leaves the instance as it was. The rule is `countryProblem` in
-- `domain`; the sync asks it first, so a device that sends a wrong country is
-- told so for its operation instead of losing its whole transmission here.

ALTER TABLE "customers" ADD CONSTRAINT "customers_country_code" CHECK ("customers"."country" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_country_code" CHECK ("sites"."country" ~ '^[A-Z]{2}$');
