-- An offer the customer turned down (#841, decided on 04.11.2026).
--
-- **The new table** `offer_declines`: one row per issued quote or cost
-- estimate the office marked as declined, with the day and a reason it may
-- leave out. Beside the document, because an issued document is fixed;
-- taking the mark back deletes the row, and the audit log keeps both. It
-- goes to no device and carries no columns of the sync.
--
-- Everything down to the policy comes from the schema; FORCE, the grant and
-- the trigger are written by hand.
--
-- **Fits the version before it**: it reads the table nowhere and writes
-- nothing else.
CREATE TABLE "offer_declines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"declined_on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_declines_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "offer_declines_document_key" UNIQUE("tenant_id","document_id"),
	CONSTRAINT "offer_declines_reason_fits" CHECK (char_length(coalesce("offer_declines"."reason", '')) <= 500)
);
--> statement-breakpoint
ALTER TABLE "offer_declines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offer_declines" ADD CONSTRAINT "offer_declines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_declines" ADD CONSTRAINT "offer_declines_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "offer_declines" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("offer_declines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("offer_declines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "offer_declines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "offer_declines" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "offer_declines"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
