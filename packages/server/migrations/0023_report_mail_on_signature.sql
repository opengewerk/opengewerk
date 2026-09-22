-- Whether a report the customer signs on site goes to that customer by mail
-- at once. A setting with a period of validity like the others: it is read on
-- the day of the signature, so switching it on sends nothing signed before.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing here does.
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'report.mail_on_signature';
