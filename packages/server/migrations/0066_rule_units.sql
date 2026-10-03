-- The units of the rule engine gain six values: months, tenths of a degree
-- Celsius, kilowatts, kilograms and tonnes of CO2 equivalent and a count per
-- 100 ml (opengewerk-haustechnik#16). They came with the duties of whoever
-- runs a building, and the units of the rule engine live in the foundation.
--
-- `rule_unit` is the type of `tenant_parameters.unit`, made from the list in
-- the foundation (`ruleUnits`), and a list that grows without its enum would
-- surface as six statements in somebody else's next migration. This
-- application stores none of the new values; nothing here uses them, which a
-- value added in the same transaction may not be anyway.

ALTER TYPE "public"."rule_unit" ADD VALUE 'months';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'decidegrees_celsius';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'kilowatts';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'kilograms_co2e';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'tonnes_co2e';--> statement-breakpoint
ALTER TYPE "public"."rule_unit" ADD VALUE 'count_per_100_ml';