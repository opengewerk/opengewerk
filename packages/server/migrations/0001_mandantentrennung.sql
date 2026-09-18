-- Mandantentrennung. Die Zeilen ab CREATE POLICY erzeugt drizzle-kit aus dem
-- Schema, der Kopf hier steht von Hand, weil drizzle-kit drei Dinge nicht
-- kennt, ohne die der Rest wirkungslos ist.
--
-- 1. Die Rolle. Row Level Security gilt nie für einen Superuser, und für den
--    Eigentümer einer Tabelle nur dann, wenn sie FORCE sagt. Die Anwendung
--    verbindet sich deshalb als opengewerk_app: keine Superuser-Rechte, kein
--    Eigentum an den Tabellen.
-- 2. Die Rechte. Ohne GRANT sieht die Rolle die Tabellen gar nicht, mit GRANT
--    sieht sie nur, was die Policy durchlässt.
-- 3. FORCE ROW LEVEL SECURITY. Ohne das umgeht der Eigentümer der Tabelle
--    jede Policy. Wer die Anwendung versehentlich als Eigentümer verbindet,
--    hätte dann eine Absicherung, die aussieht wie eine und keine ist.
--
-- Die Rolle bekommt hier absichtlich kein Passwort und kein LOGIN. Beides
-- setzt, wer die Instanz einrichtet; Zugangsdaten gehören nicht in eine
-- Migration, die in jedem Klon des Repositories liegt.

DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opengewerk_app') THEN
		CREATE ROLE "opengewerk_app" NOLOGIN;
	END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "opengewerk_app";--> statement-breakpoint

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_sections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "circuits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "circuits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "distribution_boards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "distribution_boards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inverters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inverters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_modules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_strings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_strings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("contacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("contacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("customers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("customers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("documents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("documents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "board_sections" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("board_sections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("board_sections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "circuits" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("circuits"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("circuits"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "distribution_boards" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("distribution_boards"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("distribution_boards"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("equipment"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("equipment"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "installations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("installations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("installations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "jobs" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("jobs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("jobs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inverters" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("inverters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("inverters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pv_modules" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("pv_modules"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("pv_modules"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pv_strings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("pv_strings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("pv_strings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sites" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("sites"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sites"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenants" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tenants"."id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenants"."id" = nullif(current_setting('app.tenant_id', true), '')::uuid);