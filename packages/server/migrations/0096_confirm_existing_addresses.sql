-- Marks every address that was there before 0095 as confirmed, which 0095
-- meant to do and did not (opengewerk#754). An installation migrates as the
-- owner of the tables, and the owner may only read `auth_users`
-- (`readable_by_the_owner`, 0011): under FORCE ROW LEVEL SECURITY its UPDATE
-- found no row and said nothing. The tests migrated as somebody to whom the
-- policies do not apply and did not see it.
--
-- Row level security is lifted on the accounts for the one statement, as
-- 0081 does for the sessions. On an installation that ran 0095 with 0.6.4
-- this also confirms the address of an account set up since, which 0.6.4 had
-- left unconfirmed.
ALTER TABLE "auth_users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "auth_users" SET "email_verified" = true WHERE "email_verified" IS NOT true;--> statement-breakpoint
ALTER TABLE "auth_users" FORCE ROW LEVEL SECURITY;
