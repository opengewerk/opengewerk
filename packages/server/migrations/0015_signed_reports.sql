-- What the report of #73 needs: a customer's signature on a document, and the
-- state a signed document is in until the office issues it.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grant, the four triggers of the new table and
-- a new version of the function that keeps documents fixed.
--
-- **Why `signed` is a status and not a column.** Every rule that keeps a
-- document from changing asks one question, whether its status is `draft`: the
-- sync rules for the document and for its lines, the trigger on the lines, the
-- routes. A signed document has to answer that question with no, and a status
-- of its own makes all of them do so without a line of them changed.
--
-- **Why nothing here uses the new value.** A value added to an enum cannot be
-- used in the transaction that adds it, and all pending migrations run in one.
-- So no statement below compares against 'signed' while the migration runs;
-- the two functions that do are compiled when they first run, after it.
--
-- **Why only SELECT and INSERT.** A signature is written once and never again.
-- The grant is the first half of that, a trigger that refuses every role the
-- second.

ALTER TYPE "public"."document_status" ADD VALUE 'signed' BEFORE 'issued';--> statement-breakpoint
CREATE TABLE "document_signatures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"device_info" text,
	"path" text NOT NULL,
	"content_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "document_signatures_signer_named" CHECK (length(btrim("document_signatures"."signer_name")) between 1 and 200),
	CONSTRAINT "document_signatures_path_shape" CHECK ("document_signatures"."path" ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$' and length("document_signatures"."path") <= 40000),
	CONSTRAINT "document_signatures_device_info_short" CHECK ("document_signatures"."device_info" is null or length("document_signatures"."device_info") <= 500)
);
--> statement-breakpoint
ALTER TABLE "document_signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_signatures_document" ON "document_signatures" USING btree ("document_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_signatures" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("document_signatures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("document_signatures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "document_signatures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "document_signatures" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "document_signatures"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "document_signatures"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- Refuses every change and every deletion, whoever asks, the superuser
-- included. A signature that could be edited afterwards would sign whatever it
-- was edited into.
CREATE FUNCTION "signature_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Unterschrift wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "document_signatures_stay_as_written" BEFORE UPDATE OR DELETE ON "document_signatures"
	FOR EACH ROW EXECUTE FUNCTION "signature_stays_as_written"();--> statement-breakpoint

-- The step from draft to signed, taken by the signature itself and in the same
-- statement, so that there is no moment in which a document carries a
-- signature and can still be changed. The sync rules refuse a signature for a
-- document that is not a draft long before this; the exception here is the
-- lock behind the lock.
CREATE FUNCTION "sign_document"() RETURNS trigger AS $$
BEGIN
	UPDATE "documents" SET "status" = 'signed'
		WHERE "id" = new."document_id" AND "status" = 'draft' AND "deleted_at" IS NULL;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Unterschrieben wird nur ein Entwurf, und dieser Beleg ist keiner mehr.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "document_signatures_sign_the_document" AFTER INSERT ON "document_signatures"
	FOR EACH ROW EXECUTE FUNCTION "sign_document"();--> statement-breakpoint

-- The version from 0004, with one state more. A signed document takes exactly
-- one step further, being issued, which adds a number and a moment and changes
-- nothing the customer signed. Everything else is refused, deleting included.
CREATE OR REPLACE FUNCTION "document_stays_fixed"() RETURNS trigger AS $$
DECLARE
	bookkeeping text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence'];
	issuing text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence', 'number', 'issued_at'];
BEGIN
	IF tg_op = 'DELETE' THEN
		IF old.status = 'signed' THEN
			RAISE EXCEPTION 'Ein unterschriebener Beleg wird nicht gelöscht.'
				USING ERRCODE = 'OG001';
		END IF;

		IF old.status <> 'draft' THEN
			RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht gelöscht, sondern storniert.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN old;
	END IF;

	IF old.status = 'draft' THEN
		RETURN new;
	END IF;

	IF old.status = 'signed' THEN
		IF new.status = 'issued' AND to_jsonb(new) - issuing IS NOT DISTINCT FROM to_jsonb(old) - issuing THEN
			RETURN new;
		END IF;

		RAISE EXCEPTION 'Ein unterschriebener Beleg wird nicht mehr geändert. Festschreiben lässt er sich noch.'
			USING ERRCODE = 'OG001';
	END IF;

	IF old.status = 'issued' AND new.status = 'cancelled' THEN
		IF to_jsonb(new) - bookkeeping IS DISTINCT FROM to_jsonb(old) - bookkeeping THEN
			RAISE EXCEPTION 'Beim Stornieren darf sich außer dem Status nichts ändern.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN new;
	END IF;

	RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht geändert, sondern storniert und neu ausgestellt.'
		USING ERRCODE = 'OG001';
END;
$$ LANGUAGE plpgsql;
