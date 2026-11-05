-- The site of a deleted customer deleted under the deletion concept (#848,
-- Feature-Gliederung v2.74), after #845 (0130) and #846 (0131). Deleting a
-- customer leaves its sites with their installations and protocols, without
-- anything of the customer, as proof of the business until ten years after the
-- last protocol (section 199 (3) BGB). This deletes them then.
--
-- **The kind** `site` of `erasure_kind`. A new value of an enum is not usable
-- in the transaction that adds it, so nothing below compares with it as an
-- enum; `site_erasing` compares its text, as `customer_erasing` does.
--
-- **The way in**: `site_erasing(site)` is true only in the transaction that
-- wrote the line of the protocol `erasures` for that site (`xmin` of the line
-- is the transaction's own). Only whoever leads writes such a line (0129), and
-- it stays for good. `site_of_row` finds the site of a row through its keys
-- (site, installation, appliance, job, defect, access).
--
-- **The locks that open for it**: `form_record_stays_signed` lets a signed
-- protocol be emptied, and `defect_changes` a defect, accepted or from an
-- acceptance; neither may move. What the application may now change or delete
-- only for this goes through `goes_only_with_its_site`, which refuses with the
-- sentence of what it guards: the steps of a defect (the signer, the
-- signature, `deleted_at`), the handovers of a PV documentation, and the
-- traces of who saw an access and to which device it went (DELETE). The files
-- at a site, its installations and their defects go through `purge_attachment`
-- (0087), which `application_attachment_may_go` now opens for a site as well.
--
-- Everything else a deletion of a site touches the application could change
-- already: the rows that travel to the devices are emptied and marked as
-- deleted (ADR 0005), and `keep_label_blocked` and `pv_link_holds` refuse
-- nothing of it.
--
-- **Fits the version before it**: the older version writes no value it does
-- not know, and every grant and lock refuses it exactly what it refused before.
ALTER TYPE "public"."erasure_kind" ADD VALUE 'site';--> statement-breakpoint
CREATE FUNCTION "site_erasing"(p_site uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_site IS NOT NULL AND EXISTS (
		SELECT 1 FROM public.erasures e
		 WHERE e.record_id = p_site
		   AND e.kind::text = 'site'
		   AND e.xmin = pg_current_xact_id()::xid)
$$;--> statement-breakpoint
CREATE FUNCTION "site_of_row"(p_row jsonb) RETURNS uuid
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	found uuid := (p_row->>'site_id')::uuid;
BEGIN
	IF found IS NULL AND p_row->>'installation_id' IS NOT NULL THEN
		SELECT site_id INTO found FROM public.installations WHERE id = (p_row->>'installation_id')::uuid;
	END IF;

	IF found IS NULL AND p_row->>'appliance_id' IS NOT NULL THEN
		SELECT site_id INTO found FROM public.appliances WHERE id = (p_row->>'appliance_id')::uuid;
	END IF;

	IF found IS NULL AND p_row->>'job_id' IS NOT NULL THEN
		SELECT site_id INTO found FROM public.jobs WHERE id = (p_row->>'job_id')::uuid;
	END IF;

	IF found IS NULL AND p_row->>'defect_id' IS NOT NULL THEN
		SELECT public.site_of_row(jsonb_build_object('installation_id', d.installation_id, 'job_id', d.job_id))
		  INTO found FROM public.defects d WHERE d.id = (p_row->>'defect_id')::uuid;
	END IF;

	IF found IS NULL AND p_row->>'site_access_id' IS NOT NULL THEN
		SELECT site_id INTO found FROM public.site_accesses WHERE id = (p_row->>'site_access_id')::uuid;
	END IF;

	RETURN found;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "goes_only_with_its_site"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF public.site_erasing(public.site_of_row(to_jsonb(old))) THEN
		IF tg_op = 'DELETE' THEN
			RETURN old;
		END IF;

		RETURN new;
	END IF;

	RAISE EXCEPTION '%', tg_argv[0]
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "form_record_stays_signed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.status = 'signed' THEN
		-- Emptied with its site ten years after the last protocol (#848), never moved.
		IF old.installation_id IS NOT DISTINCT FROM new.installation_id
		   AND old.appliance_id IS NOT DISTINCT FROM new.appliance_id
		   AND old.job_id IS NOT DISTINCT FROM new.job_id
		   AND public.site_erasing(public.site_of_row(to_jsonb(old))) THEN
			RETURN new;
		END IF;

		RAISE EXCEPTION 'Ein unterschriebenes Protokoll wird nicht mehr geändert. Eine neue Prüfung ist ein neues Protokoll.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "defect_changes"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	-- Emptied with its site ten years after the last protocol (#848), never moved.
	IF new.installation_id IS NOT DISTINCT FROM old.installation_id
	   AND new.job_id IS NOT DISTINCT FROM old.job_id
	   AND public.site_erasing(public.site_of_row(to_jsonb(old))) THEN
		RETURN new;
	END IF;

	IF old.status = 'accepted' THEN
		RAISE EXCEPTION 'Der Mangel ist abgenommen und ändert sich nicht mehr.'
			USING ERRCODE = 'OG008';
	END IF;

	IF new.status IS DISTINCT FROM old.status
		AND current_setting('app.defect_step', true) IS DISTINCT FROM new.id::text THEN
		RAISE EXCEPTION 'Wo ein Mangel steht, ändert nur ein neuer Schritt.'
			USING ERRCODE = 'OG013';
	END IF;

	IF new.created_by IS DISTINCT FROM old.created_by
		OR new.reported_at IS DISTINCT FROM old.reported_at
		OR new.acceptance_record_id IS DISTINCT FROM old.acceptance_record_id
		OR new.acceptance_line IS DISTINCT FROM old.acceptance_line
		OR (old.acceptance_record_id IS NOT NULL AND new.job_id IS DISTINCT FROM old.job_id) THEN
		RAISE EXCEPTION 'Wer einen Mangel gemeldet hat, wann und aus welcher Abnahme, ändert sich nicht.'
			USING ERRCODE = 'OG012';
	END IF;

	IF new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
		AND (old.status <> 'reported' OR old.acceptance_record_id IS NOT NULL) THEN
		RAISE EXCEPTION 'Entfernen lässt sich nur ein Mangel, der noch gemeldet ist und nicht aus einer Abnahme kommt.'
			USING ERRCODE = 'OG010';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "application_attachment_may_go"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM public.attachments a
		 WHERE a.id = p_attachment
		   AND (public.customer_erasing(coalesce(a.customer_id,
		         (SELECT j.customer_id FROM public.jobs j WHERE j.id = a.job_id)))
		        OR public.site_erasing(public.site_of_row(to_jsonb(a)))))
$$;--> statement-breakpoint
GRANT UPDATE ("signer_name", "signature_path", "deleted_at") ON "defect_steps" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "defect_steps_stay_as_written" BEFORE UPDATE ON "defect_steps"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_site"('Ein Schritt an einem Mangel wird weder geändert noch gelöscht.');--> statement-breakpoint
GRANT DELETE ON "pv_handovers" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "pv_handovers_stay_as_written" BEFORE UPDATE OR DELETE ON "pv_handovers"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_site"('Eine Übergabe der PV-Anlagendokumentation wird weder geändert noch gelöscht.');--> statement-breakpoint
GRANT DELETE ON "site_access_reveals" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "site_access_reveals_stay" BEFORE DELETE ON "site_access_reveals"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_site"('Wer einen Zugang angezeigt hat, bleibt festgehalten.');--> statement-breakpoint
GRANT DELETE ON "site_access_deliveries" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "site_access_deliveries_stay" BEFORE DELETE ON "site_access_deliveries"
	FOR EACH ROW EXECUTE FUNCTION "goes_only_with_its_site"('An welches Gerät ein Zugang ging, bleibt festgehalten.');
