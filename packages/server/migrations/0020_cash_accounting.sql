-- Cash accounting, section 20 UStG: whether the tax office permitted the
-- business to calculate its VAT on the amounts it received. A setting with a
-- period of validity, like the small business claim and the transition of 2027
-- next to it, because the permission starts on a day and can end on another,
-- and an invoice has to be read by what applied on its own date.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing here does.
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'cash_accounting.permitted';
