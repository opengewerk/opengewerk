-- Takes back 0114 (#303). The protocols of appliances go with them, as in
-- the rollback of 0099 past the policy, and a protocol hangs on an
-- installation again; the three units stay in
-- `rule_unit`, since a value cannot be taken out of an enum and an unused one
-- does no harm (as in the rollback of 0077).
ALTER TABLE "form_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "form_records" WHERE "appliance_id" IS NOT NULL;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "form_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_records" DROP CONSTRAINT "form_records_one_subject";--> statement-breakpoint
ALTER TABLE "form_records" DROP CONSTRAINT "form_records_appliance_in_tenant";--> statement-breakpoint
DROP INDEX "form_records_appliance_idx";--> statement-breakpoint
ALTER TABLE "form_records" DROP COLUMN "appliance_id";--> statement-breakpoint
ALTER TABLE "form_records" ALTER COLUMN "installation_id" SET NOT NULL;--> statement-breakpoint
DROP TABLE "appliances";--> statement-breakpoint
DROP TYPE "public"."appliance_mobility";--> statement-breakpoint
DROP TYPE "public"."appliance_protection_class";
