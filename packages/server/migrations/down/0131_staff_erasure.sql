-- Takes back 0131 (#846). A line of the protocol says which sickness, which
-- year of a person and which file the deletion concept deleted, and this
-- rollback deletes none of them. While there is one, it stops. Which they
-- are, this shows:
--
--   select kind, label, created_at from erasures
--    where kind::text in ('sickness', 'staff_year', 'person');
--
-- What a deletion already took stays gone; the locks close again as they
-- were before.

DO $$
BEGIN
	ALTER TABLE "erasures" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "erasures" WHERE kind::text IN ('sickness', 'staff_year', 'person')) THEN
		RAISE EXCEPTION 'Es gibt schon gelöschte Krankheiten, Jahre oder Akten im Protokoll des Löschkonzepts. Die Rücknahme von 0131 löscht sie nicht und bricht deshalb ab.';
	END IF;

	ALTER TABLE "erasures" FORCE ROW LEVEL SECURITY;

	-- The staff going by themselves is a setting, and it goes with the kinds.
	ALTER TABLE "erasure_automations" NO FORCE ROW LEVEL SECURITY;
	DELETE FROM "erasure_automations" WHERE kind::text IN ('sickness', 'staff_year', 'person');
	ALTER TABLE "erasure_automations" FORCE ROW LEVEL SECURITY;
END
$$;

DROP TRIGGER "location_consents_go_with_their_person" ON "location_consents";
REVOKE DELETE ON "location_consents" FROM "opengewerk_app";
DROP TRIGGER "qualifications_take_their_certificate" ON "qualifications";
DROP TRIGGER "qualifications_go_with_the_file" ON "qualifications";
REVOKE DELETE ON "qualifications" FROM "opengewerk_app";
DROP TRIGGER "working_times_go_with_the_file" ON "working_times";
REVOKE DELETE ON "working_times" FROM "opengewerk_app";
DROP TRIGGER "leave_entitlements_go_with_their_year" ON "leave_entitlements";
REVOKE DELETE ON "leave_entitlements" FROM "opengewerk_app";
DROP TRIGGER "absences_go_with_their_year" ON "absences";
REVOKE DELETE ON "absences" FROM "opengewerk_app";
DROP TRIGGER "on_call_shifts_go_with_their_year" ON "on_call_shifts";
REVOKE DELETE ON "on_call_shifts" FROM "opengewerk_app";
REVOKE DELETE ON "time_entries" FROM "opengewerk_app";

-- The lock on the records of time as 0036 wrote it.
CREATE OR REPLACE FUNCTION "time_entry_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'DELETE' AND current_date > ((old.started_at AT TIME ZONE 'Europe/Berlin')::date + 7 + interval '2 years')::date THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Ein Zeiteintrag wird nicht geändert und vor Ablauf der Aufbewahrung nach § 17 MiLoG nicht gelöscht. Eine Korrektur ist ein neuer Eintrag.'
		USING ERRCODE = 'OG001';
END;
$$;

DROP FUNCTION "qualification_takes_its_certificate"();
DROP FUNCTION "location_consent_goes_with_its_person"();
DROP FUNCTION "goes_with_the_file"();
DROP FUNCTION "leave_goes_with_its_year"();
DROP FUNCTION "absence_goes_with_its_year"();
DROP FUNCTION "on_call_shift_goes_with_its_year"();
DROP FUNCTION "time_entry_year"(uuid);
DROP FUNCTION "person_erasing"(uuid);
DROP FUNCTION "staff_year_erasing"(uuid, integer);
DROP FUNCTION "staff_erasing"(text, uuid);
DROP FUNCTION "staff_year_key"(uuid, integer);

-- An enum keeps a value once added; the type is built anew without them.
ALTER TYPE "public"."erasure_kind" RENAME TO "erasure_kind_with_staff";
CREATE TYPE "public"."erasure_kind" AS ENUM('prospect', 'customer');
ALTER TABLE "erasures" ALTER COLUMN "kind" TYPE "public"."erasure_kind" USING "kind"::text::"public"."erasure_kind";
ALTER TABLE "erasure_automations" ALTER COLUMN "kind" TYPE "public"."erasure_kind" USING "kind"::text::"public"."erasure_kind";
DROP TYPE "public"."erasure_kind_with_staff";
