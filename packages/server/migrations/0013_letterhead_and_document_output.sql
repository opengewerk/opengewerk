-- What a document is printed from, and where the printed document is kept.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: the grants, the audit triggers, and the trigger that keeps
-- the two new document tables as they were written.
--
-- **Why a letterhead has a table of its own.** One row per business, and
-- `tenants` would have had room for it. But `tenants` is readable from outside
-- a business, as far as a person's memberships reach, because the chooser after
-- signing in has to show names. A tax number and a bank account have no place
-- in that list, so they sit where only the ordinary isolation applies.
--
-- **Why `files` holds no bytes.** ADR 0007 keeps them in a directory whose file
-- names are their SHA-256, shared by every business on the instance. This table
-- is what makes a file belong to somebody: row level security decides here
-- whether a hash may be read, and a hash without a row is a string and not a
-- way in.
--
-- **Why a document takes a snapshot of itself when it is issued.** Its content
-- comes from the customer and the letterhead, and both change afterwards. A PDF
-- printed a year later from the live rows would show an address the customer
-- did not have when the invoice went out. `document_snapshots` is written in the
-- same transaction that hands out the number, and everything printed later is
-- printed from it.
--
-- **Why the PDF is not made at the same moment.** The renderer is a container
-- an installation may leave out, and issuing an invoice must not fail because
-- of it. `document_files` is written by the first request for the PDF instead,
-- and every later request gets those bytes back. What they say is fixed either
-- way, because they come from the snapshot.
--
-- **Why a trigger as well as the grant.** The application may only insert into
-- both document tables and read them, which already stops it from changing
-- anything. The trigger stops everybody else too, including a person at a psql
-- prompt with the owner's password. A record of what was sent that can be
-- edited afterwards is a draft with a longer name.

CREATE TYPE "public"."document_file_purpose" AS ENUM('pdf');--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"purpose" "document_file_purpose" NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"media_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_sha256_is_hex" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_size_not_negative" CHECK ("files"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "letterheads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_name" text,
	"street" text,
	"house_number" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"tax_number" text,
	"vat_id" text,
	"iban" text,
	"bic" text,
	"bank_name" text,
	"register_court" text,
	"register_number" text,
	"managing_directors" text,
	"logo_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "letterheads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "service_from" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "service_until" date;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letterheads" ADD CONSTRAINT "letterheads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letterheads" ADD CONSTRAINT "letterheads_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_purpose" ON "document_files" USING btree ("document_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "document_snapshots_document" ON "document_snapshots" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_content" ON "files" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "letterheads_tenant" ON "letterheads" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_service_period" CHECK ("documents"."service_until" is null
        or ("documents"."service_from" is not null and "documents"."service_until" >= "documents"."service_from"));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_files" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("document_files"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("document_files"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_snapshots" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("document_snapshots"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("document_snapshots"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("files"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("files"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "letterheads" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("letterheads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("letterheads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "letterheads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Inserted and read, nothing more. A file an issued document points at has to
-- outlive every mistake, and a retention period that ends is a procedure of
-- its own, logged as such, that nothing here does yet.
GRANT SELECT, INSERT ON "files" TO "opengewerk_app";--> statement-breakpoint

-- Written by its business and changed by it. No DELETE: a letterhead that is
-- no longer wanted is one whose fields are empty, which an UPDATE says just as
-- well and says in the log.
GRANT SELECT, INSERT, UPDATE ON "letterheads" TO "opengewerk_app";--> statement-breakpoint

GRANT SELECT, INSERT ON "document_snapshots" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "document_files" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "files"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "letterheads"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "document_snapshots"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "document_files"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- Refuses every change and every deletion, whoever asks. The message is German
-- because a person reads it, and OG001 is the class the application already
-- turns into "this document is fixed".
CREATE FUNCTION "stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Was zu einem festgeschriebenen Beleg gehört, wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "document_snapshots_stay_as_written" BEFORE UPDATE OR DELETE ON "document_snapshots"
	FOR EACH ROW EXECUTE FUNCTION "stays_as_written"();--> statement-breakpoint
CREATE TRIGGER "document_files_stay_as_written" BEFORE UPDATE OR DELETE ON "document_files"
	FOR EACH ROW EXECUTE FUNCTION "stays_as_written"();
