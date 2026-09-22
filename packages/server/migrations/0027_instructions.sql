-- Instructions, #109: the texts a business hands its customers with a
-- document, first of all the instruction on withdrawal of section 312g BGB.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE, the grant and the audit trigger.
--
-- **Why a shipped instruction is a row without words.** The model instruction
-- and its form are the law's words, and the law changes them: they changed on
-- 28.05.2022 and again on 19.06.2026. A business that has not touched them gets
-- the words out of the package that ships with the application, in the version
-- in force on the day of the document, so that a change in the law arrives as
-- an update. Only when the business changes the words do they end up in
-- `body`, and `based_on` says which version they were changed from.
--
-- **Why no row for the shipped ones is written here.** They are written by the
-- server the first time a business asks for its instructions, and so is every
-- one a later version ships. A migration that wrote them for the businesses of
-- today would leave out the business set up tomorrow.
--
-- **Why DELETE is granted.** An instruction the business wrote is deleted for
-- real, like a text snippet: every document that carried it keeps its words in
-- its snapshot. A shipped one is kept, the route refuses to delete it.

CREATE TYPE "public"."instruction_template" AS ENUM('withdrawal', 'withdrawal_form', 'early_start');--> statement-breakpoint
CREATE TABLE "instructions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template" "instruction_template",
	"title" text NOT NULL,
	"body" text,
	"based_on" date,
	"kinds" "document_kind"[] DEFAULT '{}' NOT NULL,
	"consumers_only" boolean DEFAULT false NOT NULL,
	"with_document" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructions_words" CHECK ("instructions"."template" is not null or "instructions"."body" is not null),
	CONSTRAINT "instructions_based_on" CHECK ("instructions"."based_on" is null or ("instructions"."template" is not null and "instructions"."body" is not null))
);
--> statement-breakpoint
ALTER TABLE "instructions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instructions" ADD CONSTRAINT "instructions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instructions_template" ON "instructions" USING btree ("tenant_id","template") WHERE "instructions"."template" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "instructions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("instructions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("instructions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "instructions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "instructions" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "instructions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
