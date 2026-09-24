-- Collective invoices, #135: one invoice over every open report of a job,
-- one report for each day of work, and each report has that invoice as its
-- one successor. The place where links of the chain run together (section
-- 1.4); `predecessor_document_id` names one document and stays empty on such
-- an invoice, its sources are the rows of `document_sources`.
--
-- Everything down to the policy comes from the schema. What follows is written
-- by hand: FORCE and the grants, the audit and sync triggers, and the three
-- triggers that hold the chain together for every way in the route does not
-- cover. A source is an issued report of the invoice's job that nothing else
-- continues; a report in an invoice that counts gets no other successor; and
-- an invoice that is cancelled or deleted as a draft releases its reports, so
-- that the one replacing it can take them, as a cancelled successor frees its
-- predecessor in `continuesChain`.
--
-- The application may read, insert and set `released_at`, and nothing else:
-- a source is never changed and never removed, a released one stays as the
-- record of what the invoice was made out of.

CREATE TABLE "document_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sources_not_itself" CHECK ("document_sources"."document_id" <> "document_sources"."source_document_id")
);
--> statement-breakpoint
ALTER TABLE "document_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_source_in_tenant" FOREIGN KEY ("tenant_id","source_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_sources_one_invoice" ON "document_sources" USING btree ("tenant_id","source_document_id") WHERE "document_sources"."released_at" is null;--> statement-breakpoint
CREATE INDEX "document_sources_document_idx" ON "document_sources" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_sources" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("document_sources"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("document_sources"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "document_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "document_sources" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("released_at") ON "document_sources" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "document_sources"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "document_sources"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- A source is an issued report of the invoice's job, and the invoice is one:
-- a final invoice, the kind a report leads to. A report that a successor
-- already continues is not open any more. Under the policy of the business, a
-- document of another business is not found here, and the keys answer for it.
CREATE FUNCTION "source_fits_invoice"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	invoice record;
	source record;
BEGIN
	SELECT kind, job_id INTO invoice
		FROM documents WHERE id = new.document_id AND tenant_id = new.tenant_id;

	IF NOT FOUND THEN
		RETURN new;
	END IF;

	SELECT kind, status, job_id INTO source
		FROM documents WHERE id = new.source_document_id AND tenant_id = new.tenant_id;

	IF NOT FOUND THEN
		RETURN new;
	END IF;

	IF invoice.kind <> 'final_invoice' OR source.kind <> 'time_and_material_report' THEN
		RAISE EXCEPTION 'Eine Sammelrechnung ist eine Rechnung über Regieberichte.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF source.status <> 'issued' OR source.job_id IS DISTINCT FROM invoice.job_id THEN
		RAISE EXCEPTION 'Eine Sammelrechnung fasst die festgeschriebenen Regieberichte ihres Auftrags zusammen.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF EXISTS (
		SELECT 1 FROM documents
			WHERE predecessor_document_id = new.source_document_id AND tenant_id = new.tenant_id
				AND deleted_at IS NULL AND status <> 'cancelled'
				AND kind NOT IN ('cancellation_invoice', 'credit_note')
	) THEN
		RAISE EXCEPTION 'Aus diesem Regiebericht ist schon ein Folgebeleg entstanden.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "document_sources_fit" BEFORE INSERT ON "document_sources"
	FOR EACH ROW EXECUTE FUNCTION "source_fits_invoice"();--> statement-breakpoint

-- The other half of the one successor: a report in a collective invoice that
-- counts gets no successor of its own. What does not count as a successor is
-- what `continuesChain` in `domain` and the index `documents_one_successor`
-- leave out.
CREATE FUNCTION "successor_of_uncollected_report"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.predecessor_document_id IS NOT NULL AND new.deleted_at IS NULL
		AND new.status <> 'cancelled' AND new.kind NOT IN ('cancellation_invoice', 'credit_note')
		AND EXISTS (
			SELECT 1 FROM document_sources
				WHERE source_document_id = new.predecessor_document_id AND tenant_id = new.tenant_id
					AND released_at IS NULL
		)
	THEN
		RAISE EXCEPTION 'Aus diesem Regiebericht ist schon eine Sammelrechnung entstanden.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "documents_successor_of_uncollected_report" BEFORE INSERT OR UPDATE OF "predecessor_document_id" ON "documents"
	FOR EACH ROW EXECUTE FUNCTION "successor_of_uncollected_report"();--> statement-breakpoint

-- An invoice cancelled, or deleted while it is a draft, no longer counts as
-- the successor of its reports, and they are open for the invoice that
-- replaces it. Stamped rather than removed: the row stays as the record of
-- what the invoice was made out of.
CREATE FUNCTION "release_sources"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF (new.status = 'cancelled' AND old.status <> 'cancelled')
		OR (new.deleted_at IS NOT NULL AND old.deleted_at IS NULL)
	THEN
		UPDATE document_sources SET released_at = now()
			WHERE document_id = new.id AND tenant_id = new.tenant_id AND released_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "documents_release_sources" AFTER UPDATE OF "status", "deleted_at" ON "documents"
	FOR EACH ROW EXECUTE FUNCTION "release_sources"();
