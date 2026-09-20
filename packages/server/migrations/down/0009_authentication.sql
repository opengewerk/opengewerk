-- The rollback for 0009_authentication.sql.
--
-- The order is the opposite of the one the tables were created in, because
-- every `auth_` table is pointed at by the two that carry a tenant, and
-- `auth_users` is pointed at by all the rest.
--
-- What this does not undo: the audit entries that `memberships` and
-- `tenant_sessions` produced while they existed. They stay, and they have to.
-- An entry is written once and never touched again, the chain is hashed over
-- the whole row, and removing a run out of the middle of it would turn a sound
-- log into one that reports a break. An installation that rolls this back has
-- a log that mentions tables it no longer has, which is the honest record of
-- what happened.

DROP TRIGGER IF EXISTS "audit_changes" ON "tenant_sessions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "memberships";--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "own_membership_outside_tenant" ON "memberships";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_rate_limits";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_passkeys";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_two_factors";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_verifications";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_accounts";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_users";--> statement-breakpoint
-- The second policy on `tenants`, which is the one table here that already
-- existed. It has to go before `memberships` does, because it reads it.
DROP POLICY IF EXISTS "own_tenants_outside_tenant" ON "tenants";--> statement-breakpoint

DROP TABLE IF EXISTS "tenant_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "memberships";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_rate_limits";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_passkeys";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_two_factors";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_verifications";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_accounts";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_users";
