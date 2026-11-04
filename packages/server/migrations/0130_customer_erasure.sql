-- Customers restricted and deleted under the deletion concept (#845,
-- Feature-Gliederung v2.72). Part 2 of 3 after #317 (0129).
--
-- **The new table** `erasure_requests`: a request of a customer to be
-- deleted (Art. 17 DSGVO) from the request to its end. Recorded by whoever
-- may change customers, `created_by` from the request through
-- `record_note_author`; answered only by whoever leads the business (a
-- restrictive policy for UPDATE, as on `erasures`), and only forwards: open
-- to restricted or erased, restricted to erased, and erased only in the
-- transaction that deletes the customer.
--
-- **The kind** `customer` of `erasure_kind`. A new value of an enum is not
-- usable in the transaction that adds it, so nothing below compares with it
-- as an enum; `customer_erasing` compares its text.
--
-- **The way in**: `customer_erasing(customer)` is true only in the
-- transaction that wrote the line of the protocol `erasures` for that
-- customer (`xmin` of the line is the transaction's own). Only whoever leads
-- writes such a line (0129), and it stays for good: every lock below opens
-- only while a customer is being deleted, and never without a trace.
--
-- **The locks that open for it**: `document_stays_fixed`,
-- `document_line_stays_fixed` and `signature_stays_as_written` let an update
-- through early; the snapshots and files of a document leave the general
-- `stays_as_written` for `goes_only_with_its_customer`, which finds the
-- customer of a row through its keys (customer, document, job) and refuses
-- with the sentence
-- of the lock it replaces. The same lock guards what the application may now
-- change or delete only for this: the history (DELETE), the notes of a job
-- and the requests for an early start (the text, the signature and
-- `deleted_at`), a signature (the same), the sources of a document
-- (`deleted_at`), the snapshots and files of a document and the choices of
-- instructions (DELETE). The outbox belongs to the foundation and is not
-- touched here: what it holds of a customer is emptied with the grant the
-- application has always had.
--
-- **Files**: the bytes of a document go with it. After a row of
-- `document_files` is deleted, `document_file_takes_its_file` deletes the
-- file as the owner of the tables, unless another key still names it, through
-- the lock of 0087 (`app.taking_file`). The files of a customer and its jobs
-- go through `purge_attachment` (0087), which this migration opens with
-- `application_attachment_may_go`.
--
-- **The count**: the line of the protocol is written first, so that the locks
-- open; how many values the change log blacked out is known only at the end.
-- The application may set `redactions`, only in the transaction that wrote
-- the line and only by whoever leads; nobody may delete a line.
--
-- Everything down to the policies comes from the schema; FORCE, the grants,
-- the functions and the triggers are written by hand.
--
-- **Fits the version before it**: the older version reads none of the new
-- table, writes no value it does not know, and every grant and lock refuses
-- it exactly what it refused before.
CREATE TYPE "public"."erasure_request_channel" AS ENUM('letter', 'email', 'phone', 'in_person', 'other');--> statement-breakpoint
CREATE TYPE "public"."erasure_request_status" AS ENUM('open', 'restricted', 'erased');--> statement-breakpoint
ALTER TYPE "public"."erasure_kind" ADD VALUE 'customer';--> statement-breakpoint
CREATE TABLE "erasure_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"channel" "erasure_request_channel" NOT NULL,
	"status" "erasure_request_status" DEFAULT 'open' NOT NULL,
	"answer_due_on" date NOT NULL,
	"restricted_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erasure_requests_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "erasure_requests_stand" CHECK (("erasure_requests"."status" = 'open' and "erasure_requests"."restricted_at" is null and "erasure_requests"."erased_at" is null)
        or ("erasure_requests"."status" = 'restricted' and "erasure_requests"."restricted_at" is not null and "erasure_requests"."erased_at" is null)
        or ("erasure_requests"."status" = 'erased' and "erasure_requests"."erased_at" is not null)),
	CONSTRAINT "erasure_requests_answer_after" CHECK ("erasure_requests"."answer_due_on" >= "erasure_requests"."received_on")
);
--> statement-breakpoint
ALTER TABLE "erasure_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erasure_requests_one_at_a_time" ON "erasure_requests" USING btree ("tenant_id","customer_id") WHERE "erasure_requests"."status" <> 'erased';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "erasure_requests" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("erasure_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("erasure_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "answered_by_whoever_leads" ON "erasure_requests" AS RESTRICTIVE FOR UPDATE TO "opengewerk_app" USING (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date))) WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));
--> statement-breakpoint
ALTER TABLE "erasure_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "erasure_requests" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("status", "restricted_at", "erased_at", "updated_at") ON "erasure_requests" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "erasure_requests"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "erasure_requests_record_author" BEFORE INSERT ON "erasure_requests"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();--> statement-breakpoint
CREATE FUNCTION "customer_erasing"(p_customer uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_customer IS NOT NULL AND EXISTS (
		SELECT 1 FROM public.erasures e
		 WHERE e.record_id = p_customer
		   AND e.kind::text = 'customer'
		   AND e.xmin = pg_current_xact_id()::xid)
$$;--> statement-breakpoint
CREATE FUNCTION "customer_of_row"(p_row jsonb) RETURNS uuid
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	found uuid := (p_row->>'customer_id')::uuid;
BEGIN
	IF found IS NULL AND p_row->>'document_id' IS NOT NULL THEN
		SELECT customer_id INTO found FROM public.documents WHERE id = (p_row->>'document_id')::uuid;
	END IF;

	IF found IS NULL AND p_row->>'job_id' IS NOT NULL THEN
		SELECT customer_id INTO found FROM public.jobs WHERE id = (p_row->>'job_id')::uuid;
	END IF;

	RETURN found;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "goes_only_with_its_customer"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF public.customer_erasing(public.customer_of_row(to_jsonb(old))) THEN
		IF tg_op = 'DELETE' THEN
			RETURN old;
		END IF;

		RETURN new;
	END IF;

	RAISE EXCEPTION '%', tg_argv[0]
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "document_stays_fixed"() RETURNS trigger
	LANGUAGE plpgsql
AS $$
DECLARE
	bookkeeping text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence'];
	issuing text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence', 'number', 'issued_at', 'issued_by'];
BEGIN
	-- Emptied with its customer once nothing holds it (#845), never deleted.
	IF tg_op = 'UPDATE' AND old.customer_id = new.customer_id
	   AND public.customer_erasing(old.customer_id) THEN
		RETURN new;
	END IF;

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
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "document_line_stays_fixed"() RETURNS trigger
	LANGUAGE plpgsql
AS $$
DECLARE
	parent_status public.document_status;
BEGIN
	-- Emptied with the customer of its document (#845), never moved.
	IF tg_op = 'UPDATE' AND old.document_id = new.document_id
	   AND public.customer_erasing(public.customer_of_row(jsonb_build_object('document_id', old.document_id))) THEN
		RETURN new;
	END IF;

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
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "signature_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	-- Emptied with the customer of its document (#845), never deleted.
	IF tg_op = 'UPDATE' AND old.document_id = new.document_id
	   AND public.customer_erasing(public.customer_of_row(jsonb_build_object('document_id', old.document_id))) THEN
		RETURN new;
	END IF;

	RAISE EXCEPTION 'Eine Unterschrift wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
DROP TRIGGER "document_snapshots_stay_as_written" ON "document_snapshots";--> statement-breakpoint
CREATE TRIGGER "document_snapshots_stay_as_written" BEFORE UPDATE OR DELETE ON "document_snapshots"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_customer"('Was zu einem festgeschriebenen Beleg gehört, wird weder geändert noch gelöscht.');--> statement-breakpoint
DROP TRIGGER "document_files_stay_as_written" ON "document_files";--> statement-breakpoint
CREATE TRIGGER "document_files_stay_as_written" BEFORE UPDATE OR DELETE ON "document_files"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_customer"('Was zu einem festgeschriebenen Beleg gehört, wird weder geändert noch gelöscht.');--> statement-breakpoint
CREATE FUNCTION "document_file_takes_its_file"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	hash text;
BEGIN
	-- Only a row the lock let go reaches this: one of a customer being deleted.
	SELECT sha256 INTO hash FROM public.files WHERE id = old.file_id AND tenant_id = old.tenant_id;

	IF hash IS NULL THEN
		RETURN NULL;
	END IF;

	PERFORM set_config('app.taking_file', old.tenant_id::text || '/' || hash, true);

	BEGIN
		DELETE FROM public.files WHERE id = old.file_id AND tenant_id = old.tenant_id;
	EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
		-- Another record still names the file, and it stays.
		NULL;
	END;

	PERFORM set_config('app.taking_file', '', true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "document_file_takes_its_file"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "document_files_take_their_file" AFTER DELETE ON "document_files"
	FOR EACH ROW EXECUTE FUNCTION "document_file_takes_its_file"();--> statement-breakpoint
GRANT DELETE ON "document_snapshots" TO "opengewerk_app";--> statement-breakpoint
GRANT DELETE ON "document_files" TO "opengewerk_app";--> statement-breakpoint
GRANT DELETE ON "communications" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "communications_stay_as_written" BEFORE UPDATE OR DELETE ON "communications"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_customer"('Ein Eintrag im Verlauf wird weder geändert noch gelöscht.');--> statement-breakpoint
GRANT UPDATE ("text", "deleted_at") ON "job_notes" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "job_notes_stay_as_written" BEFORE UPDATE OR DELETE ON "job_notes"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_customer"('Eine Notiz am Auftrag wird weder geändert noch gelöscht.');--> statement-breakpoint
GRANT UPDATE ("signer_name", "path", "device_info", "deleted_at") ON "early_start_requests" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "early_start_requests_stay_as_written" BEFORE UPDATE OR DELETE ON "early_start_requests"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_customer"('Eine unterschriebene Bitte um den früheren Beginn wird weder geändert noch gelöscht.');--> statement-breakpoint
GRANT UPDATE ("signer_name", "path", "device_info", "deleted_at") ON "document_signatures" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("deleted_at") ON "document_sources" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "document_sources_stay_until_their_customer_goes" BEFORE UPDATE OF "deleted_at" ON "document_sources"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_customer"('Die Quelle einer Rechnung wird nicht gelöscht.');--> statement-breakpoint
GRANT DELETE ON "document_instruction_choices" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "document_instruction_choices_stay" BEFORE DELETE ON "document_instruction_choices"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_customer"('Die Belehrungen eines Belegs werden nicht gelöscht.');--> statement-breakpoint
CREATE FUNCTION "application_attachment_may_go"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM public.attachments a
		 WHERE a.id = p_attachment
		   AND public.customer_erasing(coalesce(a.customer_id,
		         (SELECT j.customer_id FROM public.jobs j WHERE j.id = a.job_id))))
$$;--> statement-breakpoint
CREATE FUNCTION "erasure_request_moves_on"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF to_jsonb(new) - ARRAY['status', 'restricted_at', 'erased_at', 'updated_at']
	   IS DISTINCT FROM to_jsonb(old) - ARRAY['status', 'restricted_at', 'erased_at', 'updated_at'] THEN
		RAISE EXCEPTION 'An einer Löschanfrage ändert sich nur ihr Stand.'
			USING ERRCODE = 'OG001';
	END IF;

	IF old.status::text = 'open' AND new.status::text = 'restricted' THEN
		RETURN new;
	END IF;

	IF old.status::text IN ('open', 'restricted') AND new.status::text = 'erased'
	   AND public.customer_erasing(old.customer_id) THEN
		RETURN new;
	END IF;

	RAISE EXCEPTION 'Eine Löschanfrage geht nur vorwärts, und erledigt ist sie erst mit dem Löschen ihres Kunden.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "erasure_requests_move_on" BEFORE UPDATE ON "erasure_requests"
	FOR EACH ROW EXECUTE FUNCTION "erasure_request_moves_on"();--> statement-breakpoint
CREATE POLICY "counted_by_whoever_leads" ON "erasures" AS RESTRICTIVE FOR UPDATE TO "opengewerk_app" USING (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date))) WITH CHECK (exists (select 1 from public.memberships m join public.tenant_roles r on r.tenant_id = m.tenant_id and r.key = any (m.roles) and r.leads where m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and m.user_id = nullif(current_setting('app.user_id', true), '') and m.blocked_at is null and (m.last_day is null or m.last_day >= (now() at time zone 'Europe/Berlin')::date)));--> statement-breakpoint
GRANT UPDATE ("redactions") ON "erasures" TO "opengewerk_app";--> statement-breakpoint
CREATE FUNCTION "erasure_counted_in_its_transaction"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'UPDATE'
	   AND to_jsonb(new) - 'redactions' IS NOT DISTINCT FROM to_jsonb(old) - 'redactions'
	   AND EXISTS (SELECT 1 FROM public.erasures e WHERE e.id = old.id AND e.xmin = pg_current_xact_id()::xid) THEN
		RETURN new;
	END IF;

	RAISE EXCEPTION 'Eine Zeile im Protokoll des Löschkonzepts wird nicht geändert.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "erasures_counted_in_their_transaction" BEFORE UPDATE OR DELETE ON "erasures"
	FOR EACH ROW EXECUTE FUNCTION "erasure_counted_in_its_transaction"();
