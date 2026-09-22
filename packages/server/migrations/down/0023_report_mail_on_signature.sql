-- Rolling back the setting for signed reports.
--
-- The enum value is taken out the only way PostgreSQL offers, by building the
-- type anew without it. A row that already carries it blocks the cast: it
-- decided which reports went to their customers, and a rollback that dropped
-- it quietly would rewrite that.
ALTER TABLE "tenant_parameters" ALTER COLUMN "key" TYPE text;--> statement-breakpoint
DROP TYPE "public"."tenant_parameter_key";--> statement-breakpoint
CREATE TYPE "public"."tenant_parameter_key" AS ENUM('small_business.claimed', 'invoice.payment_term_days', 'e_invoice.transition_claimed', 'cash_accounting.permitted');--> statement-breakpoint
ALTER TABLE "tenant_parameters" ALTER COLUMN "key" TYPE "public"."tenant_parameter_key" USING "key"::"public"."tenant_parameter_key";
