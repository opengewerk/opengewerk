-- Takes back 0102 (#786). Who made a document goes with its column, and the
-- right `document.delete` leaves every role that has it.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_remove("rights", 'document.delete')
 WHERE 'document.delete' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "created_by";
