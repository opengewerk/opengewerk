-- Payments, #189: what came in on an invoice, recorded in the office, so that
-- a final invoice takes off what was received on the progress invoices before
-- it (section 14 (5) UStG) and not what they billed.
--
-- Everything down to the policy comes from the schema. What follows it is
-- written by hand: FORCE and the grants, and the audit trigger. The table is
-- on the server only and not synced, so it has no sync columns and no stamp.
-- A payment recorded by mistake is removed, not marked: DELETE is granted,
-- UPDATE is not, and the audit log keeps what was there.

CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_document_idx" ON "payments" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("payments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("payments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "payments" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "payments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
