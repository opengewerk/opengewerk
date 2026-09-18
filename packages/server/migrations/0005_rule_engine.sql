-- What a business sets for itself. The legal parameters are not here: they
-- ship as data packages in the repository, versioned and with the paragraph
-- they come from, and nothing in a database can reach them.
--
-- That separation is the whole point of section 1.7. A tenant sets whether it
-- claims the small business rule; it does not get to say what the threshold
-- is. The key here is an enum of settings, so there is no row a business could
-- write that would move a legal figure.
--
-- The three lines below FORCE are the ones drizzle-kit never writes and every
-- new table needs again. The audit trigger is among them: it was attached to
-- everything that existed in 0003, and a table added later has to ask for it.

CREATE TYPE "public"."rule_unit" AS ENUM('basis_points', 'cents', 'days', 'flag');--> statement-breakpoint
CREATE TYPE "public"."tenant_parameter_key" AS ENUM('small_business.claimed', 'invoice.payment_term_days');--> statement-breakpoint
CREATE TABLE "tenant_parameters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" "tenant_parameter_key" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"unit" "rule_unit" NOT NULL,
	"value" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_parameters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_parameters" ADD CONSTRAINT "tenant_parameters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_parameters_start" ON "tenant_parameters" USING btree ("tenant_id","key","valid_from");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_parameters" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tenant_parameters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_parameters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "tenant_parameters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_parameters" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tenant_parameters"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
