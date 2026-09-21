-- What a quote needs beyond #71: titles among its lines, a text above and
-- below them, and a list of texts to take them from.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: the grant, the audit trigger and FORCE on the new table.
--
-- **Why a title is a kind of line.** Its place in the list is the whole of its
-- meaning, everything up to the next title belongs to it. As a line it moves
-- with the same field as the positions, travels to a device like them, and is
-- frozen with its document by the trigger from 0010 without a line of new
-- code. The check keeps it free of amounts, so a total can never contain a
-- figure nobody sees as a position.
--
-- **Why the new columns cost nothing on a running installation.** A column
-- with a constant default is added without rewriting a single row, and one
-- without a default is empty anyway. No row changes, so neither the triggers
-- that freeze an issued document nor the audit trigger ever see this
-- migration.
--
-- **Why snippets are deleted for real.** A snippet is a writing aid and not a
-- record of anything. Every document that used one holds its own copy of the
-- text, and the audit log keeps the deletion.

CREATE TYPE "public"."line_kind" AS ENUM('item', 'title');--> statement-breakpoint
CREATE TYPE "public"."snippet_purpose" AS ENUM('line', 'intro', 'closing');--> statement-breakpoint
CREATE TABLE "text_snippets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" "snippet_purpose" NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "text_snippets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "kind" "line_kind" DEFAULT 'item' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "intro_text" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "closing_text" text;--> statement-breakpoint
ALTER TABLE "text_snippets" ADD CONSTRAINT "text_snippets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "text_snippets_purpose_idx" ON "text_snippets" USING btree ("tenant_id","purpose");--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_title_has_no_amount" CHECK ("document_lines"."kind" = 'item' or ("document_lines"."quantity_milli" = 0 and "document_lines"."unit_price_cents" = 0));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "text_snippets" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("text_snippets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("text_snippets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "text_snippets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "text_snippets" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "text_snippets"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
