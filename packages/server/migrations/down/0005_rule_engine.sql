-- The rollback for 0005_rule_engine.sql.

DROP TRIGGER IF EXISTS "audit_changes" ON "tenant_parameters";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_parameters";--> statement-breakpoint
DROP TABLE IF EXISTS "tenant_parameters";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."tenant_parameter_key";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."rule_unit";
