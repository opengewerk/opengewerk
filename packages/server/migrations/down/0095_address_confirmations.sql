-- Takes the addresses that wait for their link out again, back to how 0094
-- left things. A link in a mail that went out stops working. Which addresses
-- were confirmed stays in `auth_users`, which the version before reads not.
--
-- Run as the superuser, like every rollback.
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_address_confirmations";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_address_confirmations";
