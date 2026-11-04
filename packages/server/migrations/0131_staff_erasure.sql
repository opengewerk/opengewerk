-- The staff under the deletion concept (#846, Feature-Gliederung v2.73), part 3
-- of 3 after #317 (0129) and #845 (0130), as decided on 04.11.2026: a
-- sickness goes a year after its last day, the time and leave of one year of
-- one person six years after the end of the year, the file of somebody who
-- left three years after the end of that year.
--
-- **The kinds** `sickness`, `staff_year` and `person` of `erasure_kind`. A new
-- value of an enum is not usable in the transaction that adds it, so nothing
-- below compares with it as an enum; `staff_erasing` compares its text.
--
-- **The key of a year**: `staff_year_key(person, year)`, the first 32 hex
-- digits of the SHA-256 of "<person>/<year>" as a uuid, which the server
-- computes the same way. A line of the protocol keys one year of one person
-- with it, and names neither.
--
-- **The year of a record of time** is the year of the entry it corrects, up
-- to the first (`time_entry_year`): a correction across New Year goes with
-- the entry it corrects, and the deletion takes a chain from its end.
--
-- **The way in**: `staff_erasing(kind, record)` is true only in the
-- transaction that wrote the line of the protocol `erasures` for that record
-- (`xmin` of the line is the transaction's own), as `customer_erasing` (0130);
-- only whoever leads writes such a line (0129). `person_erasing(person)` is
-- true while the file or any year of the person goes.
--
-- **The locks that open for it**: the application may now delete records of
-- time, times of the on-call plan, absences, the days of leave of a year, the
-- working time agreed, qualifications and the answers about the place, and
-- each only while what it belongs to goes: a record of time and a time on
-- call with the year of their person, and the record of time still not before
-- the two years of § 17 MiLoG (0036); an absence as a sickness of its own or
-- with its year; the days of leave with their year; the working time and the
-- qualifications with the file; an answer about the place with the person.
--
-- **Files**: the certificate of a qualification goes with it, as the owner of
-- the tables through the lock of 0087 (`app.taking_file`), unless another key
-- still names it (`qualification_takes_its_certificate`).
--
-- The file itself (`people`) is emptied with the grant the application has
-- always had, and the account behind it with the foundation's
-- `removeAccountData` outside the transaction.
--
-- The enum comes from the schema; the functions, the grants and the triggers
-- are written by hand.
--
-- **Fits the version before it**: the older version deletes none of these
-- rows, and every grant and lock refuses it exactly what it refused before.
ALTER TYPE "public"."erasure_kind" ADD VALUE 'sickness';--> statement-breakpoint
ALTER TYPE "public"."erasure_kind" ADD VALUE 'staff_year';--> statement-breakpoint
ALTER TYPE "public"."erasure_kind" ADD VALUE 'person';--> statement-breakpoint
CREATE FUNCTION "staff_year_key"(p_person uuid, p_year integer) RETURNS uuid
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT left(encode(sha256(convert_to(p_person::text || '/' || p_year::text, 'UTF8')), 'hex'), 32)::uuid
$$;--> statement-breakpoint
CREATE FUNCTION "staff_erasing"(p_kind text, p_record uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_record IS NOT NULL AND EXISTS (
		SELECT 1 FROM public.erasures e
		 WHERE e.record_id = p_record
		   AND e.kind::text = p_kind
		   AND e.xmin = pg_current_xact_id()::xid)
$$;--> statement-breakpoint
CREATE FUNCTION "staff_year_erasing"(p_person uuid, p_year integer) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT public.staff_erasing('staff_year', public.staff_year_key(p_person, p_year))
$$;--> statement-breakpoint
CREATE FUNCTION "person_erasing"(p_person uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT public.staff_erasing('person', p_person) OR EXISTS (
		SELECT 1 FROM public.erasures e
		 WHERE e.kind::text = 'staff_year'
		   AND e.xmin = pg_current_xact_id()::xid
		   AND e.record_id IN (
			SELECT public.staff_year_key(p_person, y)
			  FROM generate_series(1970, extract(year FROM current_date)::integer) AS y))
$$;--> statement-breakpoint
CREATE FUNCTION "time_entry_year"(p_entry uuid) RETURNS integer
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	WITH RECURSIVE chain AS (
		SELECT t.id, t.corrects_entry_id, t.started_at, 0 AS depth
		  FROM public.time_entries t WHERE t.id = p_entry
		UNION ALL
		SELECT t.id, t.corrects_entry_id, t.started_at, c.depth + 1
		  FROM public.time_entries t JOIN chain c ON t.id = c.corrects_entry_id
		 WHERE c.depth < 100
	)
	SELECT extract(year FROM (started_at AT TIME ZONE 'Europe/Berlin'))::integer
	  FROM chain ORDER BY depth DESC LIMIT 1
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "time_entry_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	-- Deleted only with the year of its person (#846), and still not before
	-- § 17 MiLoG lets it go: two years from the seventh day after the day of work.
	IF tg_op = 'DELETE'
	   AND current_date > ((old.started_at AT TIME ZONE 'Europe/Berlin')::date + 7 + interval '2 years')::date
	   AND EXISTS (
		SELECT 1 FROM public.people p
		 WHERE p.user_id = old.user_id
		   AND public.staff_year_erasing(p.id, public.time_entry_year(old.id))) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Ein Zeiteintrag wird nicht geändert und nur mit dem Jahr seiner Person nach dem Löschkonzept gelöscht. Eine Korrektur ist ein neuer Eintrag.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "on_call_shift_goes_with_its_year"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM public.people p
		 WHERE p.user_id = old.user_id
		   AND public.staff_year_erasing(p.id, extract(year FROM (old.starts_at AT TIME ZONE 'Europe/Berlin'))::integer)) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Zeit der Rufbereitschaft wird nur mit dem Jahr ihrer Person nach dem Löschkonzept gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "absence_goes_with_its_year"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF (old.kind::text = 'sickness' AND public.staff_erasing('sickness', old.id))
	   OR public.staff_year_erasing(old.person_id, extract(year FROM old.first_day)::integer) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Abwesenheit wird nur nach dem Löschkonzept gelöscht, eine Krankheit nach ihrer Frist oder mit dem Jahr ihrer Person.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "leave_goes_with_its_year"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF public.staff_year_erasing(old.person_id, old.year) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Der Urlaubsanspruch eines Jahres wird nur mit dem Jahr seiner Person nach dem Löschkonzept gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "goes_with_the_file"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF public.staff_erasing('person', old.person_id) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION '%', tg_argv[0] USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "location_consent_goes_with_its_person"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM public.people p WHERE p.user_id = old.user_id AND public.person_erasing(p.id)) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Antwort zur Erfassung des Orts wird nur mit ihrer Person nach dem Löschkonzept gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "qualification_takes_its_certificate"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
BEGIN
	-- Only a row the lock let go reaches this: one of a file being deleted.
	IF old.certificate_sha256 IS NULL THEN
		RETURN NULL;
	END IF;

	PERFORM set_config('app.taking_file', old.tenant_id::text || '/' || old.certificate_sha256, true);

	BEGIN
		DELETE FROM public.files WHERE tenant_id = old.tenant_id AND sha256 = old.certificate_sha256;
	EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
		-- Another record still names the file, and it stays.
		NULL;
	END;

	PERFORM set_config('app.taking_file', '', true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "qualification_takes_its_certificate"() FROM PUBLIC;--> statement-breakpoint
GRANT DELETE ON "time_entries" TO "opengewerk_app";--> statement-breakpoint
GRANT DELETE ON "on_call_shifts" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "on_call_shifts_go_with_their_year" BEFORE DELETE ON "on_call_shifts"
	FOR EACH ROW EXECUTE FUNCTION "on_call_shift_goes_with_its_year"();--> statement-breakpoint
GRANT DELETE ON "absences" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "absences_go_with_their_year" BEFORE DELETE ON "absences"
	FOR EACH ROW EXECUTE FUNCTION "absence_goes_with_its_year"();--> statement-breakpoint
GRANT DELETE ON "leave_entitlements" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "leave_entitlements_go_with_their_year" BEFORE DELETE ON "leave_entitlements"
	FOR EACH ROW EXECUTE FUNCTION "leave_goes_with_its_year"();--> statement-breakpoint
GRANT DELETE ON "working_times" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "working_times_go_with_the_file" BEFORE DELETE ON "working_times"
	FOR EACH ROW EXECUTE FUNCTION "goes_with_the_file"('Eine vereinbarte Arbeitszeit wird nur mit der Akte nach dem Löschkonzept gelöscht.');--> statement-breakpoint
GRANT DELETE ON "qualifications" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "qualifications_go_with_the_file" BEFORE DELETE ON "qualifications"
	FOR EACH ROW EXECUTE FUNCTION "goes_with_the_file"('Eine Qualifikation wird nur mit der Akte nach dem Löschkonzept gelöscht.');--> statement-breakpoint
CREATE TRIGGER "qualifications_take_their_certificate" AFTER DELETE ON "qualifications"
	FOR EACH ROW EXECUTE FUNCTION "qualification_takes_its_certificate"();--> statement-breakpoint
GRANT DELETE ON "location_consents" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "location_consents_go_with_their_person" BEFORE DELETE ON "location_consents"
	FOR EACH ROW EXECUTE FUNCTION "location_consent_goes_with_its_person"();
