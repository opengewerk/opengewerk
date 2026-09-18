-- Die Rücknahme zu 0001_mandantentrennung.sql.
--
-- Die Policies fallen mit DROP POLICY, die Schalter mit DISABLE. Die Rolle
-- bleibt stehen: sie kann Rechte an anderer Stelle haben, und eine Migration,
-- die beim Zurückrollen eine Rolle löscht, nimmt womöglich mehr mit als sie
-- angelegt hat.

DROP POLICY IF EXISTS "tenant_isolation" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "customers";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "documents";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "board_sections";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "circuits";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "distribution_boards";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "equipment";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "installations";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "jobs";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "inverters";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "pv_modules";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "pv_strings";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "sites";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tenants";--> statement-breakpoint

ALTER TABLE "contacts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_sections" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_sections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "circuits" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "circuits" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "distribution_boards" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "distribution_boards" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inverters" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inverters" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_modules" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_modules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_strings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_strings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" FROM "opengewerk_app";--> statement-breakpoint
REVOKE USAGE ON SCHEMA "public" FROM "opengewerk_app";
