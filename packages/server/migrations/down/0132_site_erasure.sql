-- Takes back 0132 (#848). A line of the protocol says which site the deletion
-- concept deleted, and this rollback deletes none of them. While there is one,
-- it stops. Which they are, this shows:
--
--   select label, created_at from erasures where kind::text = 'site';
--
-- What a deletion already took stays gone; the locks close again as they were
-- before, and `erasure_kind` is made again without `site`, as 0131 does for
-- the kinds of the staff.

DO $$
BEGIN
	ALTER TABLE "erasures" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "erasures" WHERE kind::text = 'site') THEN
		RAISE EXCEPTION 'Es gibt schon gelöschte Objekte im Protokoll des Löschkonzepts. Die Rücknahme von 0132 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "erasures" FORCE ROW LEVEL SECURITY;

	-- The sites going by themselves is a setting, and it goes with the kind.
	ALTER TABLE "erasure_automations" NO FORCE ROW LEVEL SECURITY;
	DELETE FROM "erasure_automations" WHERE kind::text = 'site';
	ALTER TABLE "erasure_automations" FORCE ROW LEVEL SECURITY;
END
$$;

DROP TRIGGER "site_access_deliveries_stay" ON "site_access_deliveries";
REVOKE DELETE ON "site_access_deliveries" FROM "opengewerk_app";
DROP TRIGGER "site_access_reveals_stay" ON "site_access_reveals";
REVOKE DELETE ON "site_access_reveals" FROM "opengewerk_app";
DROP TRIGGER "pv_handovers_stay_as_written" ON "pv_handovers";
REVOKE DELETE ON "pv_handovers" FROM "opengewerk_app";
DROP TRIGGER "defect_steps_stay_as_written" ON "defect_steps";
REVOKE UPDATE ("signer_name", "signature_path", "deleted_at") ON "defect_steps" FROM "opengewerk_app";

-- The way files go as 0130 wrote it: only with a customer.
CREATE OR REPLACE FUNCTION "application_attachment_may_go"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM public.attachments a
		 WHERE a.id = p_attachment
		   AND public.customer_erasing(coalesce(a.customer_id,
		         (SELECT j.customer_id FROM public.jobs j WHERE j.id = a.job_id))))
$$;

-- The locks on defects and protocols as they were before.
CREATE OR REPLACE FUNCTION "defect_changes"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION "form_record_stays_signed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.status = 'signed' THEN
		RAISE EXCEPTION 'Ein unterschriebenes Protokoll wird nicht mehr geändert. Eine neue Prüfung ist ein neues Protokoll.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$;

DROP FUNCTION "goes_only_with_its_site"();
DROP FUNCTION "site_of_row"(jsonb);
DROP FUNCTION "site_erasing"(uuid);

ALTER TYPE "public"."erasure_kind" RENAME TO "erasure_kind_with_site";
CREATE TYPE "public"."erasure_kind" AS ENUM('prospect', 'customer', 'sickness', 'staff_year', 'person');
ALTER TABLE "erasures" ALTER COLUMN "kind" TYPE "public"."erasure_kind" USING "kind"::text::"public"."erasure_kind";
ALTER TABLE "erasure_automations" ALTER COLUMN "kind" TYPE "public"."erasure_kind" USING "kind"::text::"public"."erasure_kind";
DROP TYPE "public"."erasure_kind_with_site";
