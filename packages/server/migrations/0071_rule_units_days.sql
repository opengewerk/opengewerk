-- The units of the rule engine gain two values: a day of the year and the
-- distance to Easter Sunday (opengewerk-haustechnik#200). They came with the
-- public holidays of a state, which are rules like any other, and the units
-- of the rule engine live in the foundation.
--
-- `rule_unit` is the type of `tenant_parameters.unit`, made from the list in
-- the foundation (`ruleUnits`), as in 0066. This application stores none of
-- the new values.

ALTER TYPE "public"."rule_unit" ADD VALUE 'month_day';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'days_from_easter';