-- Takes back 0123 (#294). A maintenance contract is what the office agreed
-- with a customer, and a service job made by one is work: this rollback
-- deletes neither. While there is one, it stops. Which they are, this shows:
--
--   select id, number, designation from maintenance_contracts;
--   select id, number, maintenance_due_on from jobs where maintenance_contract_id is not null;
--
-- The value `contract` of number_range_key stays, PostgreSQL cannot take one
-- back; a range stored under it stays too, and the version before does not
-- read it.

DO $$
BEGIN
	ALTER TABLE "maintenance_contracts" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "jobs" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "maintenance_contracts")
		OR EXISTS (SELECT 1 FROM "jobs" WHERE "maintenance_contract_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt schon Wartungsverträge. Die Rücknahme von 0123 würde sie löschen und bricht deshalb ab.';
	END IF;

	ALTER TABLE "maintenance_contracts" FORCE ROW LEVEL SECURITY;
	ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
END
$$;

ALTER TABLE "jobs" DROP CONSTRAINT "jobs_maintenance_visit";
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_maintenance_visit_key";
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_maintenance_contract_in_tenant";
ALTER TABLE "jobs" DROP COLUMN "maintenance_due_on";
ALTER TABLE "jobs" DROP COLUMN "maintenance_contract_id";
DROP TABLE "maintenance_contracts";
