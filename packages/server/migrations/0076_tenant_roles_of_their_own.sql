-- Roles a tenant keeps of its own (opengewerk/opengewerk-haustechnik#346).
--
-- Up to here the application could read `tenant_roles` and insert into it,
-- and nothing else: a tenant had the roles it started with. From here it may
-- change of a row its label, its rights, whether it asks for a second factor
-- and what it was offered, and remove a row. Its key, which a membership
-- names, and whether it leads stay as the row was written: a membership keeps
-- naming the same role, and no row comes to lead a tenant later. Which rows a
-- tenant changes and which rights a role of its own holds, an application
-- decides on its routes; this business software ships none yet.
--
-- `offered_rights` is what the catalogue offered when a role of the tenant's
-- own was last saved, so that a right a later version brings can be told
-- apart from one the tenant left out. Every row gets the empty list, which is
-- what a shipped role keeps.
--
-- No row is touched beyond the new column. A version of the application from
-- before this one reads the rows as before and leaves the column alone.

ALTER TABLE "tenant_roles" ADD COLUMN "offered_rights" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "tenant_roles" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("label", "rights", "second_factor", "offered_rights", "updated_at") ON "tenant_roles" TO "opengewerk_app";
