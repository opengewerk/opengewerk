-- What the office chose on a document about its instructions, #109: the kind
-- of contract the instruction on withdrawal is filled in for, and the
-- instructions switched on or off against the proposal.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE, the grant and the audit trigger.
--
-- **Why a table of its own and not columns on `documents`.** A document
-- travels to devices, and every column on it is one a device could send. The
-- choice is made at a desk, through a route, before issuing, which needs a
-- connection anyway; kept here, it stays out of the outbox and out of the
-- trigger that freezes an issued document. What went out is frozen in the
-- snapshot, and after issuing this row says nothing any more.
--
-- **Why the instruction ids are not held by a key.** They sit in two arrays,
-- and an instruction the business deletes leaves its id behind, naming
-- nothing. A key would have to reach into an array, and would make deleting an
-- instruction depend on every draft that ever switched it.
--
-- **Why no DELETE.** A row is changed, not removed: switching everything back
-- to the proposal leaves an empty row, which says the same as none.

CREATE TYPE "public"."withdrawal_variant" AS ENUM('service', 'goods');--> statement-breakpoint
CREATE TABLE "document_instruction_choices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"variant" "withdrawal_variant" DEFAULT 'service' NOT NULL,
	"switched_on" uuid[] DEFAULT '{}' NOT NULL,
	"switched_off" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_instruction_choices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_instruction_choices" ADD CONSTRAINT "document_instruction_choices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_instruction_choices" ADD CONSTRAINT "document_instruction_choices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_instruction_choices_document" ON "document_instruction_choices" USING btree ("document_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_instruction_choices" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("document_instruction_choices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("document_instruction_choices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "document_instruction_choices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "document_instruction_choices" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "document_instruction_choices"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
