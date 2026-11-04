-- Takes back 0130 (#845). A request for deletion is what a customer asked
-- and a line of the protocol says which customer the deletion concept
-- deleted, and this rollback deletes neither. While there is one, it stops.
-- Which they are, this shows:
--
--   select received_on, status from erasure_requests;
--   select label, created_at from erasures where kind::text = 'customer';
--
-- What a deletion already emptied stays empty; the locks close again as they
-- were before.

DO $$
BEGIN
	ALTER TABLE "erasures" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "erasure_requests" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "erasure_requests")
	   OR EXISTS (SELECT 1 FROM "erasures" WHERE kind::text = 'customer') THEN
		RAISE EXCEPTION 'Es gibt schon Löschanfragen oder gelöschte Kunden im Protokoll des Löschkonzepts. Die Rücknahme von 0130 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "erasures" FORCE ROW LEVEL SECURITY;

	-- Customers going by themselves is a setting, and it goes with the kind.
	ALTER TABLE "erasure_automations" NO FORCE ROW LEVEL SECURITY;
	DELETE FROM "erasure_automations" WHERE kind::text = 'customer';
	ALTER TABLE "erasure_automations" FORCE ROW LEVEL SECURITY;
END
$$;

DROP TRIGGER "erasures_counted_in_their_transaction" ON "erasures";
DROP FUNCTION "erasure_counted_in_its_transaction"();
REVOKE UPDATE ("redactions") ON "erasures" FROM "opengewerk_app";
DROP POLICY "counted_by_whoever_leads" ON "erasures";

DROP FUNCTION "application_attachment_may_go"(uuid);

DROP TRIGGER "document_instruction_choices_stay" ON "document_instruction_choices";
REVOKE DELETE ON "document_instruction_choices" FROM "opengewerk_app";
DROP TRIGGER "document_sources_stay_until_their_customer_goes" ON "document_sources";
REVOKE UPDATE ("deleted_at") ON "document_sources" FROM "opengewerk_app";
REVOKE UPDATE ("signer_name", "path", "device_info", "deleted_at") ON "document_signatures" FROM "opengewerk_app";
DROP TRIGGER "early_start_requests_stay_as_written" ON "early_start_requests";
REVOKE UPDATE ("signer_name", "path", "device_info", "deleted_at") ON "early_start_requests" FROM "opengewerk_app";
DROP TRIGGER "job_notes_stay_as_written" ON "job_notes";
REVOKE UPDATE ("text", "deleted_at") ON "job_notes" FROM "opengewerk_app";
DROP TRIGGER "communications_stay_as_written" ON "communications";
REVOKE DELETE ON "communications" FROM "opengewerk_app";
REVOKE DELETE ON "document_files" FROM "opengewerk_app";
REVOKE DELETE ON "document_snapshots" FROM "opengewerk_app";

DROP TRIGGER "document_files_take_their_file" ON "document_files";
DROP FUNCTION "document_file_takes_its_file"();
DROP TRIGGER "document_files_stay_as_written" ON "document_files";
CREATE TRIGGER "document_files_stay_as_written" BEFORE UPDATE OR DELETE ON "document_files"
	FOR EACH ROW EXECUTE FUNCTION "stays_as_written"();
DROP TRIGGER "document_snapshots_stay_as_written" ON "document_snapshots";
CREATE TRIGGER "document_snapshots_stay_as_written" BEFORE UPDATE OR DELETE ON "document_snapshots"
	FOR EACH ROW EXECUTE FUNCTION "stays_as_written"();

CREATE OR REPLACE FUNCTION "signature_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Unterschrift wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;

CREATE OR REPLACE FUNCTION "document_line_stays_fixed"() RETURNS trigger
	LANGUAGE plpgsql
AS $$
DECLARE
	parent_status public.document_status;
BEGIN
	IF tg_op <> 'INSERT' THEN
		SELECT status INTO parent_status FROM public.documents WHERE id = old.document_id FOR SHARE;
		IF tg_op = 'DELETE' AND parent_status IS NULL THEN
			RETURN old;
		END IF;
		IF parent_status IS DISTINCT FROM 'draft' THEN
			RAISE EXCEPTION 'Die Positionen eines festgeschriebenen Belegs werden nicht geändert.'
				USING ERRCODE = 'OG001';
		END IF;
	END IF;
	IF tg_op <> 'DELETE' THEN
		-- Both sides when a line moves to another document. A missing document
		-- is an error here and not a special case: a line without a head
		-- belongs to nothing.
		SELECT status INTO parent_status FROM public.documents WHERE id = new.document_id FOR SHARE;
		IF parent_status IS DISTINCT FROM 'draft' THEN
			RAISE EXCEPTION 'Die Positionen eines festgeschriebenen Belegs werden nicht geändert.'
				USING ERRCODE = 'OG001';
		END IF;
	END IF;
	IF tg_op = 'DELETE' THEN
		RETURN old;
	END IF;
	RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION "document_stays_fixed"() RETURNS trigger
	LANGUAGE plpgsql
AS $$
DECLARE
	bookkeeping text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence'];
	issuing text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence', 'number', 'issued_at', 'issued_by'];
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
$$;

DROP FUNCTION "goes_only_with_its_customer"();
DROP FUNCTION "customer_of_row"(jsonb);
DROP FUNCTION "customer_erasing"(uuid);

DROP TABLE "erasure_requests";
DROP FUNCTION "erasure_request_moves_on"();
DROP TYPE "public"."erasure_request_status";
DROP TYPE "public"."erasure_request_channel";

-- An enum keeps a value once added; the type is built anew without it.
ALTER TYPE "public"."erasure_kind" RENAME TO "erasure_kind_with_customer";
CREATE TYPE "public"."erasure_kind" AS ENUM('prospect');
ALTER TABLE "erasures" ALTER COLUMN "kind" TYPE "public"."erasure_kind" USING "kind"::text::"public"."erasure_kind";
ALTER TABLE "erasure_automations" ALTER COLUMN "kind" TYPE "public"."erasure_kind" USING "kind"::text::"public"."erasure_kind";
DROP TYPE "public"."erasure_kind_with_customer";
