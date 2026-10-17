-- Takes the roles of a tenant's own out again, back to how 0075 left things:
-- the application reads and inserts roles and nothing else, and the column of
-- what a role was offered goes without asking. A role a tenant made stays as a
-- row with the rights it had. Run as the superuser, like every rollback.
REVOKE UPDATE ("label", "rights", "second_factor", "offered_rights", "updated_at") ON "tenant_roles" FROM "opengewerk_app";--> statement-breakpoint
REVOKE DELETE ON "tenant_roles" FROM "opengewerk_app";--> statement-breakpoint
ALTER TABLE "tenant_roles" DROP COLUMN "offered_rights";
