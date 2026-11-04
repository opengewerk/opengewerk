-- The history at a customer and at a site (#313, Feature-Gliederung v2.70).
--
-- **The new table** `communications`: the notes and calls the office writes
-- down at a customer, and at one of its sites where it says so, with who wrote
-- it and when it was. Written once: the grant stops at INSERT, as for the
-- notes of a job (0045), and `created_by` comes from the request through the
-- same trigger function `record_note_author`. It goes to no device and carries
-- no columns of the sync.
--
-- Everything down to the policy comes from the schema; FORCE, the grant and
-- the two triggers are written by hand.
--
-- **Fits the version before it**: it reads the table nowhere and writes
-- nothing else.
CREATE TYPE "public"."call_direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint
CREATE TYPE "public"."communication_kind" AS ENUM('note', 'call');--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid,
	"kind" "communication_kind" NOT NULL,
	"direction" "call_direction",
	"counterpart" text,
	"text" text NOT NULL,
	"happened_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communications_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "communications_kind_fits" CHECK (("communications"."kind" = 'call') = ("communications"."direction" is not null)
        and ("communications"."kind" = 'call' or "communications"."counterpart" is null)),
	CONSTRAINT "communications_texts_fit" CHECK (char_length("communications"."text") between 1 and 5000
        and char_length(coalesce("communications"."counterpart", '')) <= 200)
);
--> statement-breakpoint
ALTER TABLE "communications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communications_customer_idx" ON "communications" USING btree ("tenant_id","customer_id","happened_at");--> statement-breakpoint
CREATE INDEX "communications_site_idx" ON "communications" USING btree ("tenant_id","site_id","happened_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "communications" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("communications"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("communications"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "communications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "communications" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "communications"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "communications_record_author" BEFORE INSERT ON "communications"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();
