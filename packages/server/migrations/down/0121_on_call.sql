-- Takes back 0121 (#293). The times of the on-call plan and the moments of
-- emergency calls are records the business keeps: while there is one, this
-- rollback stops. The values of tenant_parameter_key stay, PostgreSQL cannot
-- take one back; a setting stored under one of them stays too, and the
-- version before does not read it.

DO $$
BEGIN
	ALTER TABLE on_call_shifts NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE jobs NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM on_call_shifts) OR EXISTS (SELECT 1 FROM jobs WHERE emergency_at IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt schon Zeiten der Rufbereitschaft oder Notdiensteinsätze. Die Rücknahme von 0121 würde sie löschen und bricht deshalb ab.';
	END IF;

	ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
END
$$;

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;
SELECT set_config('app.reason', 'migration', true);
UPDATE "tenant_roles" SET "rights" = array_remove("rights", 'job.on_call');
SELECT set_config('app.reason', '', true);
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;

DROP TABLE "on_call_shifts";
ALTER TABLE "jobs" DROP COLUMN "emergency_at";
