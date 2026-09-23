-- The files in a business's records, #77: an attachment hangs on a customer, a
-- site, an installation or a job, and its versions name the stored files.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grants, the two triggers every synced table
-- carries, one that writes who stored a version and one that keeps a version
-- as it was written.
--
-- **Why a version names its file by hash.** A device takes a photo in a cellar
-- and has no id of a `files` row to name, only the hash of the bytes it holds.
-- The key runs over tenant and hash onto the one row per business and content
-- that `files` has, so a version can only name bytes its own business stored.
--
-- **Why no UPDATE on the versions.** A new version is a new row, and an old
-- one stays readable; the grant stops at INSERT and a trigger refuses the rest
-- to everybody, the owner included, like a signature. An attachment itself is
-- synced like any field work and marked deleted rather than removed, so its
-- grant stops at UPDATE.

CREATE TABLE "attachment_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"preview_sha256" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "attachment_versions_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "attachment_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"site_id" uuid,
	"installation_id" uuid,
	"job_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "attachments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attachments_have_a_home" CHECK (num_nonnulls("attachments"."customer_id", "attachments"."site_id", "attachments"."installation_id", "attachments"."job_id") >= 1)
);
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_attachment_in_tenant" FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "public"."attachments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_file_in_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_preview_in_tenant" FOREIGN KEY ("tenant_id","preview_sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_versions_attachment_idx" ON "attachment_versions" USING btree ("tenant_id","attachment_id");--> statement-breakpoint
CREATE INDEX "attachments_customer_idx" ON "attachments" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "attachments_site_idx" ON "attachments" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "attachments_installation_idx" ON "attachments" USING btree ("tenant_id","installation_id");--> statement-breakpoint
CREATE INDEX "attachments_job_idx" ON "attachments" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachment_versions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("attachment_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("attachment_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachments" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("attachments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("attachments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "attachments" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "attachment_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "attachment_versions" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- Who stored the version, from the request and from nothing else, as ADR 0007
-- asks of the metadata of a file.
CREATE FUNCTION "record_attachment_uploader"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.created_by := nullif(current_setting('app.user_id', true), '');

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "attachment_versions_record_uploader" BEFORE INSERT ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_attachment_uploader"();--> statement-breakpoint

-- Refuses every change and every deletion, whoever asks. A version whose hash
-- could be changed afterwards would show somebody a different file than the
-- one a decision was taken on.
CREATE FUNCTION "attachment_version_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Fassung einer Datei wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "attachment_versions_stay_as_written" BEFORE UPDATE OR DELETE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "attachment_version_stays_as_written"();
