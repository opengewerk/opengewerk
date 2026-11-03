-- Takes back 0124 (#295). A recurring invoice made for a contract is a
-- document of the business, issued ones are bookkeeping: this rollback
-- deletes none. While a document names a contract, it stops. Which they are:
--
--   select id, number, service_from from documents where maintenance_contract_id is not null;
--
-- A contract that issues by itself loses only the switch.

DO $$
BEGIN
	ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "documents" WHERE "maintenance_contract_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt schon Rechnungen aus Wartungsverträgen. Die Rücknahme von 0124 würde sie löschen und bricht deshalb ab.';
	END IF;

	ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
END
$$;

ALTER TABLE "documents" DROP CONSTRAINT "documents_maintenance_period";
ALTER TABLE "documents" DROP CONSTRAINT "documents_maintenance_period_key";
ALTER TABLE "documents" DROP CONSTRAINT "documents_maintenance_contract_in_tenant";
ALTER TABLE "documents" DROP COLUMN "maintenance_contract_id";
ALTER TABLE "maintenance_contracts" DROP CONSTRAINT "maintenance_contracts_price";
ALTER TABLE "maintenance_contracts" DROP COLUMN "issue_by_itself";
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_price" CHECK ("maintenance_contracts"."price_kind" in ('flat', 'effort')
        and ("maintenance_contracts"."price_kind" = 'flat') = ("maintenance_contracts"."flat_cents" is not null)
        and coalesce("maintenance_contracts"."flat_cents", 0) between 0 and 10000000
        and "maintenance_contracts"."payment_rhythm" in ('visit', 'monthly', 'quarterly', 'yearly')
        and ("maintenance_contracts"."payment_rhythm" = 'visit' or "maintenance_contracts"."price_kind" = 'flat'));
