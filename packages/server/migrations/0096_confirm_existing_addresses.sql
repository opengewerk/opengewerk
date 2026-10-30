-- Marks the addresses that were there before 0095 as confirmed, which 0095
-- meant to do and did not (opengewerk#754). An installation migrates as the
-- owner of the tables, and the owner may only read `auth_users`
-- (`readable_by_the_owner`, 0011): under FORCE ROW LEVEL SECURITY its UPDATE
-- found no row and said nothing. The tests migrated as somebody to whom the
-- policies do not apply and did not see it. Row level security is lifted on
-- the accounts for the one statement, as 0081 does for the sessions.
--
-- **Which accounts.** Only those that were there before 0095. An account set
-- up afterwards, by redeeming a link with an address that never had a mail,
-- stays unconfirmed: that is what 0095 is for. The database keeps no record of
-- when a migration ran, so the two cases are told apart this way:
--
-- - 0095 ran in this same update. Every pending migration shares one
--   transaction, and the row of `auth_address_confirmations` in `pg_class`
--   then carries the id of this transaction. Every account is from before.
-- - 0095 ran in an earlier update, with 0.6.4. Then the accounts from before
--   are those set up before 0.6.4 existed, the moment its tag was made; no
--   installation could run 0095 earlier.
ALTER TABLE "auth_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "auth_users" SET "email_verified" = true
	WHERE "email_verified" IS NOT true
	AND (
		(SELECT "xmin"::text::bigint FROM "pg_catalog"."pg_class"
			WHERE "oid" = '"auth_address_confirmations"'::regclass)
			= pg_current_xact_id()::text::bigint % 4294967296
		OR "created_at" < '2026-10-30T05:09:38Z'
	);--> statement-breakpoint
ALTER TABLE "auth_users" FORCE ROW LEVEL SECURITY;
