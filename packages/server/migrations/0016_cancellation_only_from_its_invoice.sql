-- A cancellation invoice comes into being in one way only: made in one step
-- out of the invoice it cancels, as that invoice's mirror, by the route that
-- issues it in the same transaction. Written by hand it would be a draft
-- somebody can edit before issuing it, and a cancellation that does not mirror
-- its invoice cancels something else than it claims to.
--
-- Three ways would lead there without this: creating a document of that kind,
-- turning an existing draft into one by changing its kind, and either of the
-- two through the outbox. All three meet in this table, so the rule sits here.
--
-- The route marks its transaction with `app.cancelling`. set_config with
-- `is_local` true ends with the transaction, so the mark cannot outlive the
-- one cancellation it was set for. Nothing else sets it.

CREATE FUNCTION "cancellation_only_from_its_invoice"() RETURNS trigger AS $$
BEGIN
	IF new.kind = 'cancellation_invoice'
		AND (tg_op = 'INSERT' OR old.kind IS DISTINCT FROM new.kind)
		AND current_setting('app.cancelling', true) IS DISTINCT FROM 'on' THEN
		RAISE EXCEPTION 'Eine Stornorechnung entsteht nur aus der Rechnung, die sie aufhebt, und nie von Hand.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "documents_cancellation_only_from_its_invoice"
	BEFORE INSERT OR UPDATE OF "kind" ON "documents"
	FOR EACH ROW EXECUTE FUNCTION "cancellation_only_from_its_invoice"();
