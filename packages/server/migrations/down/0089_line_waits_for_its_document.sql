-- Takes the share lock out of the trigger on the lines again, back to how 0010
-- wrote it and 0088 left it.
--
-- Nothing is written and no row is touched. A line write then reads the status
-- of its document without waiting for a transaction that is fixing it.
--
-- Run as the superuser, like every rollback.
CREATE OR REPLACE FUNCTION "document_line_stays_fixed"() RETURNS trigger AS $$
DECLARE
	parent_status public.document_status;
BEGIN
	IF tg_op <> 'INSERT' THEN
		SELECT status INTO parent_status FROM public.documents WHERE id = old.document_id;

		IF tg_op = 'DELETE' AND parent_status IS NULL THEN
			RETURN old;
		END IF;

		IF parent_status IS DISTINCT FROM 'draft' THEN
			RAISE EXCEPTION 'Die Positionen eines festgeschriebenen Belegs werden nicht geändert.'
				USING ERRCODE = 'OG001';
		END IF;
	END IF;

	IF tg_op <> 'DELETE' THEN
		SELECT status INTO parent_status FROM public.documents WHERE id = new.document_id;

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
$$ LANGUAGE plpgsql;
