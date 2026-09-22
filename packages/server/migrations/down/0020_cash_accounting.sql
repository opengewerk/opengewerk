-- Rolling back cash accounting.
--
-- The enum value is taken out the only way PostgreSQL offers, by building the
-- type anew without it. A row that already carries it blocks the cast, and
-- that is the right way round: a permission of the tax office decided what the
-- invoices of its period had to say, and a rollback that quietly dropped it
-- would rewrite what happened.
ALTER TABLE "tenant_parameters" ALTER COLUMN "key" TYPE text;--> statement-breakpoint
DROP TYPE "public"."tenant_parameter_key";--> statement-breakpoint
CREATE TYPE "public"."tenant_parameter_key" AS ENUM('small_business.claimed', 'invoice.payment_term_days', 'e_invoice.transition_claimed');--> statement-breakpoint
ALTER TABLE "tenant_parameters" ALTER COLUMN "key" TYPE "public"."tenant_parameter_key" USING "key"::"public"."tenant_parameter_key";
