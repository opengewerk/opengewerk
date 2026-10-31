-- Takes back 0106. The setting stays in its enum, as a value cannot be taken
-- out of one (0066); its rows go, so that nothing reads one.
ALTER TABLE "tenant_parameters" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "tenant_parameters" WHERE "key" = 'delivery_note.mail_on_signature';--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_parameters" FORCE ROW LEVEL SECURITY;
