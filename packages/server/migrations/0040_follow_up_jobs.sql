-- Follow-up jobs, #170: a job after a finished job of the same customer, a
-- job of its own and not a part of the one before it, which is what the
-- parent reference is for.
--
-- Everything down to the check comes from the schema. What follows is written
-- by hand: the trigger that holds what a key cannot. The job before a
-- follow-up is finished when the follow-up is made and belongs to the same
-- customer, and which job it is is fixed when the follow-up is created; with
-- that, no chain of follow-ups can run in a circle. The sync and the routes
-- ask the same questions first, with the sentences of `followUpProblem` in the
-- domain, so that a device gets a conflict about one operation and not a
-- refused transmission.

ALTER TABLE "jobs" ADD COLUMN "predecessor_job_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_predecessor_in_tenant" FOREIGN KEY ("tenant_id","predecessor_job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_predecessor_idx" ON "jobs" USING btree ("tenant_id","predecessor_job_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_not_own_predecessor" CHECK ("jobs"."predecessor_job_id" <> "jobs"."id");--> statement-breakpoint

-- Under the policy of the business: a job of another business is not found
-- here, and the key over tenant and id answers for it.
CREATE FUNCTION "job_follows_finished_job"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	before_it record;
BEGIN
	IF tg_op = 'UPDATE' AND new.predecessor_job_id IS DISTINCT FROM old.predecessor_job_id THEN
		RAISE EXCEPTION 'Der Vorgänger eines Folgeauftrags steht mit dem Anlegen fest.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF tg_op = 'UPDATE' AND new.customer_id IS DISTINCT FROM old.customer_id AND EXISTS (
		SELECT 1 FROM jobs
			WHERE predecessor_job_id = new.id AND tenant_id = new.tenant_id
				AND customer_id <> new.customer_id AND deleted_at IS NULL
	) THEN
		RAISE EXCEPTION 'Auf diesen Auftrag folgen Aufträge für seinen Kunden, er bleibt bei ihm.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF new.predecessor_job_id IS NULL THEN
		RETURN new;
	END IF;

	SELECT status, customer_id INTO before_it
		FROM jobs
		WHERE id = new.predecessor_job_id AND tenant_id = new.tenant_id;

	IF NOT FOUND THEN
		RETURN new;
	END IF;

	IF tg_op = 'INSERT' AND before_it.status <> 'completed' THEN
		RAISE EXCEPTION 'Ein Folgeauftrag schließt an einen abgeschlossenen Auftrag an.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF before_it.customer_id <> new.customer_id THEN
		RAISE EXCEPTION 'Ein Folgeauftrag ist für denselben Kunden wie der Auftrag davor.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "jobs_follow_finished_jobs" BEFORE INSERT OR UPDATE OF "predecessor_job_id", "customer_id" ON "jobs"
	FOR EACH ROW EXECUTE FUNCTION "job_follows_finished_job"();
