-- Rolling who issued a document back to how 0045 left it.
--
-- What it costs an installation that runs it: the name at every document
-- issued since, which the audit log still holds. The trigger goes back to the
-- version from 0015 before the column goes, so that no step between the two
-- refuses what the other allows.
--
-- Run as the superuser, like every rollback.
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
$$ LANGUAGE plpgsql;--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "issued_by";
