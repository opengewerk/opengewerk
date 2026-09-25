-- Who issued a document, #249: the account that fixed it, next to the moment
-- it was fixed.
--
-- The column comes from the schema. What follows it is written by hand.
--
-- **Why no foreign key.** An issued document is fixed, and the trigger below
-- refuses every change to it. A key that emptied the column when somebody
-- leaves the business would be such a change, and removing a person from the
-- business would fail over every document they ever issued. The column holds
-- the account as it held it, like `created_by` on a task or a note.
--
-- **Why no value for the documents issued before.** The audit log knows who
-- issued them, but a document is fixed, and writing into one now would be a
-- change to something the business has already handed out. A document from
-- before shows the moment and no name.
--
-- **Why the trigger is replaced.** A signed report takes exactly one step
-- further, being issued, and the version from 0015 lets only the number and
-- the moment change with it. Who issued it is part of the same step and would
-- otherwise be refused. A draft passes the trigger unchanged, an issued
-- document still takes nothing but its cancellation.

ALTER TABLE "documents" ADD COLUMN "issued_by" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "document_stays_fixed"() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;
