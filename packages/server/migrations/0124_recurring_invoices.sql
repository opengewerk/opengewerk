-- Recurring invoices of maintenance contracts (#295, Feature-Gliederung v2.66).
--
-- **`maintenance_contracts`** gains `issue_by_itself`: whether the invoices of
-- a contract paid per period are issued and sent by mail without anybody,
-- from the second on. False for every contract there is, and only for one
-- paid per period, which the check of the price now holds as well.
--
-- **`documents`** gains `maintenance_contract_id`: the contract a recurring
-- invoice bills a period of, one per contract and start of a period, written
-- by the deadline engine. Empty for every document there is.
--
-- Everything comes from the schema; switching FORCE off on `documents` around
-- its new key and checks is written by hand: the owner migrating sees no row
-- of `documents` under FORCE.
--
-- **Fits the version before it**: it reads neither column, and writes a
-- contract and a document without them, which leaves them at their default.
ALTER TABLE "maintenance_contracts" DROP CONSTRAINT "maintenance_contracts_price";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "maintenance_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD COLUMN "issue_by_itself" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_maintenance_contract_in_tenant" FOREIGN KEY ("tenant_id","maintenance_contract_id") REFERENCES "public"."maintenance_contracts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_maintenance_period_key" UNIQUE("maintenance_contract_id","service_from");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_maintenance_period" CHECK ("documents"."maintenance_contract_id" is null or ("documents"."kind" = 'recurring_invoice' and "documents"."service_from" is not null));--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_price" CHECK ("maintenance_contracts"."price_kind" in ('flat', 'effort')
        and ("maintenance_contracts"."price_kind" = 'flat') = ("maintenance_contracts"."flat_cents" is not null)
        and coalesce("maintenance_contracts"."flat_cents", 0) between 0 and 10000000
        and "maintenance_contracts"."payment_rhythm" in ('visit', 'monthly', 'quarterly', 'yearly')
        and ("maintenance_contracts"."payment_rhythm" = 'visit' or "maintenance_contracts"."price_kind" = 'flat')
        and (not "maintenance_contracts"."issue_by_itself" or "maintenance_contracts"."payment_rhythm" <> 'visit'));