-- The units of the rule engine gain plain kilograms, for refrigerants whose
-- thresholds count by mass and not by CO2 equivalent (opengewerk-haustechnik#351),
-- and the units of the rule engine live in the foundation.
--
-- `rule_unit` is the type of `tenant_parameters.unit`, made from the list in
-- the foundation (`ruleUnits`), as in 0066 and 0071. This application stores
-- none of the new value.

ALTER TYPE "public"."rule_unit" ADD VALUE 'kilograms';
