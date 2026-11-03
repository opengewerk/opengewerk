-- Defects and complaints, #311: what is wrong with the work, at a job, at an
-- installation or at both, with the steps it takes until the customer accepts
-- the remedy.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grants, the two triggers every synced table
-- carries, who reported a defect and who took a step, the order of the steps,
-- what may still change about a defect, where the photo of one lies, and the
-- defects a signed acceptance writes out of its reservations.
--
-- **Why the steps are rows.** Where a defect stands is not written over: each
-- step is a row with who took it and when, granted INSERT and nothing else,
-- like a note. The defect keeps the step it stands at in `status`, written by
-- the trigger that takes a step and by nothing else, for the queries that ask
-- for the open defects: the deadline of the customer drops with it.
--
-- **Why the acceptance writes them.** A reservation in a signed acceptance is
-- a defect the customer kept their rights for (§ 640 Abs. 3 BGB). Written by
-- the database in the same statement that signs the protocol, whichever way it
-- comes in, once for each line: the unique index on protocol and line keeps a
-- second run from writing them again.

CREATE TYPE "public"."defect_status" AS ENUM('reported', 'in_progress', 'resolved', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."defect_step" AS ENUM('in_progress', 'resolved', 'accepted');--> statement-breakpoint
CREATE TABLE "defect_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"defect_id" uuid NOT NULL,
	"step" "defect_step" NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"signer_name" text,
	"signature_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "defect_steps_signed_acceptance" CHECK (case when "defect_steps"."step" = 'accepted'
        then length(btrim(coalesce("defect_steps"."signer_name", ''))) between 1 and 200
          and "defect_steps"."signature_path" ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
          and length("defect_steps"."signature_path") <= 40000
        else "defect_steps"."signer_name" is null and "defect_steps"."signature_path" is null end)
);
--> statement-breakpoint
ALTER TABLE "defect_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "defects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid,
	"installation_id" uuid,
	"description" text NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"remedy_due_on" date,
	"status" "defect_status" DEFAULT 'reported' NOT NULL,
	"acceptance_record_id" uuid,
	"acceptance_line" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "defects_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "defects_have_a_home" CHECK (num_nonnulls("defects"."job_id", "defects"."installation_id") >= 1),
	CONSTRAINT "defects_described" CHECK (length(btrim("defects"."description")) between 1 and 4000),
	CONSTRAINT "defects_acceptance_line" CHECK (("defects"."acceptance_record_id" is null) = ("defects"."acceptance_line" is null) and ("defects"."acceptance_line" is null or "defects"."acceptance_line" >= 1))
);
--> statement-breakpoint
ALTER TABLE "defects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "defect_id" uuid;--> statement-breakpoint
ALTER TABLE "defect_steps" ADD CONSTRAINT "defect_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_steps" ADD CONSTRAINT "defect_steps_defect_in_tenant" FOREIGN KEY ("tenant_id","defect_id") REFERENCES "public"."defects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_acceptance_in_tenant" FOREIGN KEY ("tenant_id","acceptance_record_id") REFERENCES "public"."form_records"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "defect_steps_defect_idx" ON "defect_steps" USING btree ("tenant_id","defect_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "defects_acceptance_line_once" ON "defects" USING btree ("acceptance_record_id","acceptance_line");--> statement-breakpoint
CREATE INDEX "defects_job_idx" ON "defects" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "defects_installation_idx" ON "defects" USING btree ("tenant_id","installation_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_defect_in_tenant" FOREIGN KEY ("tenant_id","defect_id") REFERENCES "public"."defects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_defect_idx" ON "attachments" USING btree ("tenant_id","defect_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "defect_steps" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("defect_steps"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("defect_steps"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "defects" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("defects"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("defects"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);;--> statement-breakpoint

ALTER TABLE "defects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "defect_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "defects" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "defect_steps" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "defect_steps"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "defect_steps"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- Who reported a defect and who took a step, from the request and from
-- nothing else, as the author of a note (0045).
CREATE TRIGGER "defects_record_author" BEFORE INSERT ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();--> statement-breakpoint
CREATE TRIGGER "defect_steps_record_author" BEFORE INSERT ON "defect_steps"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();--> statement-breakpoint

-- What may change about a defect. Where it stands only a step does, which
-- says so for its own statement; who reported it, when and out of which
-- acceptance never; the rest until it is accepted. Removing it is marking it
-- deleted, and only a defect that is still reported and does not come out of
-- an acceptance may go: a reservation is the customer's, not the business's.
CREATE FUNCTION "defect_changes"() RETURNS trigger
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
$$;--> statement-breakpoint

CREATE TRIGGER "defects_change" BEFORE UPDATE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "defect_changes"();--> statement-breakpoint

-- A step follows the one the defect stands at, the list of `nextDefectSteps`
-- in domain: in progress may be skipped, a remedy that does not hold goes back
-- to in progress, and only a remedied defect is accepted. The defect is locked
-- while it moves on, so two steps sent at once are taken one after the other,
-- and the second is measured against the first.
CREATE FUNCTION "take_defect_step"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	standing "defect_status";
	removed timestamptz;
BEGIN
	SELECT "status", "deleted_at" INTO standing, removed FROM "defects" WHERE "id" = new.defect_id FOR UPDATE;

	-- A defect this business cannot see is refused by the key, by its name.
	IF NOT FOUND THEN
		RETURN new;
	END IF;

	IF standing = 'accepted' THEN
		RAISE EXCEPTION 'Der Mangel ist abgenommen und ändert sich nicht mehr.'
			USING ERRCODE = 'OG008';
	END IF;

	IF removed IS NOT NULL OR NOT (
		(standing = 'reported' AND new.step IN ('in_progress', 'resolved'))
		OR (standing = 'in_progress' AND new.step = 'resolved')
		OR (standing = 'resolved' AND new.step IN ('in_progress', 'accepted'))
	) THEN
		RAISE EXCEPTION 'Dieser Schritt folgt nicht auf den Stand des Mangels.'
			USING ERRCODE = 'OG009';
	END IF;

	PERFORM set_config('app.defect_step', new.defect_id::text, true);
	UPDATE "defects" SET "status" = new.step::text::"defect_status" WHERE "id" = new.defect_id;
	PERFORM set_config('app.defect_step', '', true);

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "defect_steps_take" BEFORE INSERT ON "defect_steps"
	FOR EACH ROW EXECUTE FUNCTION "take_defect_step"();--> statement-breakpoint

-- The photo of a defect lies among the files of its job or of its
-- installation, so that whoever opens the job finds it there as well.
CREATE FUNCTION "defect_photo_at_its_place"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "defects"
		WHERE "id" = new.defect_id
			AND (("job_id" IS NOT NULL AND "job_id" = new.job_id)
				OR ("installation_id" IS NOT NULL AND "installation_id" = new.installation_id))
	) THEN
		RAISE EXCEPTION 'Ein Foto eines Mangels liegt bei den Dateien seines Auftrags oder seiner Anlage.'
			USING ERRCODE = 'OG011';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "attachments_defect_at_its_place" BEFORE INSERT OR UPDATE OF "defect_id", "job_id", "installation_id" ON "attachments"
	FOR EACH ROW WHEN (new.defect_id IS NOT NULL) EXECUTE FUNCTION "defect_photo_at_its_place"();--> statement-breakpoint

-- The reservations of a signed acceptance become defects at its job and at
-- the job's installation, one for each line that says something, reported on
-- the day of the acceptance; a refused acceptance names the defects it hangs
-- on in the same field. The key `acceptance` is the form of the core
-- (`acceptanceFormKey` in domain), `reservations` its field.
CREATE FUNCTION "defects_from_acceptance"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND old.status = 'signed' THEN
		RETURN NULL;
	END IF;

	INSERT INTO "defects" ("tenant_id", "job_id", "installation_id", "description", "reported_at", "acceptance_record_id", "acceptance_line")
	SELECT new.tenant_id, new.job_id, "jobs"."installation_id", left(lines.line, 4000),
		(new.performed_on::timestamp AT TIME ZONE 'Europe/Berlin'), new.id, lines.number
	FROM (
		SELECT btrim(part) AS line, row_number() OVER (ORDER BY position) AS number
		FROM regexp_split_to_table(coalesce(new.values::jsonb ->> 'reservations', ''), E'\n') WITH ORDINALITY AS split(part, position)
		WHERE btrim(part) <> ''
	) AS lines
	JOIN "jobs" ON "jobs"."id" = new.job_id
	ON CONFLICT ("acceptance_record_id", "acceptance_line") DO NOTHING;

	RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "form_records_defects_from_acceptance" AFTER INSERT OR UPDATE OF "status" ON "form_records"
	FOR EACH ROW WHEN (new.status = 'signed' AND new.definition_key = 'acceptance' AND new.job_id IS NOT NULL)
	EXECUTE FUNCTION "defects_from_acceptance"();
