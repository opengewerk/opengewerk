-- Rolling back the outgoing e-invoice.
--
-- What it costs an installation that runs it: the Käuferreferenz of every
-- customer is gone with its column. The two enum values are taken out the only
-- way PostgreSQL offers, by building each type anew without them.
--
-- A row that already carries one of the values blocks the cast, and that is
-- the right way round. An XRechnung that was stored went out to a customer,
-- and a claim of the transition decided whether invoices of 2027 had to be
-- e-invoices; a rollback that quietly dropped either would rewrite what
-- happened. Changing the type rewrites the table without firing a row trigger,
-- so the rule that keeps `document_files` as written does not stand in the way
-- where no such row exists.
ALTER TABLE "customers" DROP COLUMN IF EXISTS "buyer_reference";--> statement-breakpoint
ALTER TABLE "document_files" ALTER COLUMN "purpose" TYPE text;--> statement-breakpoint
DROP TYPE "public"."document_file_purpose";--> statement-breakpoint
CREATE TYPE "public"."document_file_purpose" AS ENUM('pdf');--> statement-breakpoint
ALTER TABLE "document_files" ALTER COLUMN "purpose" TYPE "public"."document_file_purpose" USING "purpose"::"public"."document_file_purpose";--> statement-breakpoint
ALTER TABLE "tenant_parameters" ALTER COLUMN "key" TYPE text;--> statement-breakpoint
DROP TYPE "public"."tenant_parameter_key";--> statement-breakpoint
CREATE TYPE "public"."tenant_parameter_key" AS ENUM('small_business.claimed', 'invoice.payment_term_days');--> statement-breakpoint
ALTER TABLE "tenant_parameters" ALTER COLUMN "key" TYPE "public"."tenant_parameter_key" USING "key"::"public"."tenant_parameter_key";
