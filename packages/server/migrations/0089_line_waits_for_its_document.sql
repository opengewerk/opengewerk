-- The trigger on the lines waits for its document before it judges it.
--
-- `document_line_stays_fixed` (0010) read the status of the document with a
-- plain SELECT. Under READ COMMITTED that returns the status last committed
-- and does not wait for a transaction that is issuing or signing the document
-- right now: a line written at that moment saw a draft, went in, and the
-- document was fixed with a line that is not in its snapshot. Each read of the
-- parent now takes a share lock. It conflicts with the row lock of the issuing
-- and signing UPDATE, so a late line write waits, then reads issued or signed
-- and is refused with OG001; two line writes on the same draft share the lock
-- and do not wait for each other.
--
-- The function keeps its name, its arguments and its trigger, and only the two
-- reads change. A version of the application from before this migration runs
-- on unchanged: it writes lines the same way and is refused in the same cases,
-- plus the one it used to slip through.
CREATE OR REPLACE FUNCTION "document_line_stays_fixed"() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;
