-- Rolling the ways into a site back to how 0053 left the schema (#286).
--
-- What it costs an installation that runs it: every access of every site with
-- its sealed value, and the record of who saw which. The sites stay. Every
-- device drops the two kinds of record at its next exchange.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the tables, the same choice as in every earlier rollback. The enum
-- value cannot be dropped, so the type is built again without it, as in the
-- rollback of 0052.

DROP TRIGGER "site_accesses_follow_deletion" ON "sites";--> statement-breakpoint
DROP FUNCTION "site_accesses_follow_deletion"();--> statement-breakpoint
DROP TABLE "site_access_reveals";--> statement-breakpoint
DROP TABLE "site_accesses";--> statement-breakpoint
DELETE FROM "secrets" WHERE "purpose" = 'site_access';--> statement-breakpoint
ALTER TABLE "secrets" DROP CONSTRAINT "secrets_one_per_record";--> statement-breakpoint
ALTER TABLE "secrets" DROP COLUMN "record_id";--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_one_per_purpose" UNIQUE("tenant_id","purpose");--> statement-breakpoint
ALTER TYPE "public"."secret_purpose" RENAME TO "secret_purpose_before";--> statement-breakpoint
CREATE TYPE "public"."secret_purpose" AS ENUM('smtp_password');--> statement-breakpoint
ALTER TABLE "secrets" ALTER COLUMN "purpose" TYPE "public"."secret_purpose" USING "purpose"::text::"public"."secret_purpose";--> statement-breakpoint
DROP TYPE "public"."secret_purpose_before";
