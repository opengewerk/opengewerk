-- Requests for access (#318, Art. 15 and 20 DSGVO, Feature-Gliederung v2.75).
--
-- **The new table** `access_requests`: whom a request is about, a customer, a
-- contact, a lead or the file of somebody of the staff (`personal_subject`),
-- when and how it came in, when the answer is due, when the ZIP was last drawn
-- and by whom, and when it was answered (`access_request_status`). Exactly one
-- key names the person. A lead that goes under the deletion concept takes its
-- key with it (`SET NULL (prospect_id)`, which keeps the tenant), and the
-- request stays without whom it was about. One request runs per person at a
-- time. It goes to no device.
--
-- **A contact without a key**: `contacts` belongs to the foundation and has
-- no unique key over tenant and id, so a key to it could not run over the
-- tenant as every key between two records of a business does. A trigger
-- checks instead that the contact of a new request is of its business
-- (`access_request_contact_in_tenant`); a contact that goes later leaves the
-- request without whom it was about, as a lead does.
--
-- **What may change** (`access_request_moves_on`): when the ZIP was drawn,
-- with who drew it from the request (`app.user_id`), and once whether it was
-- answered; an answered request stays answered. Everything else stays as it
-- was recorded, and every change stands in the change log.
--
-- **The right** `privacy.access` goes to the owner of every business, as the
-- code gives it to the owner. Row level security is lifted on `tenant_roles`
-- for the statement: an installation migrates as the owner, and under FORCE
-- the owner finds no row (0029, 0095).
--
-- Everything down to the policy comes from the schema; the narrowed foreign
-- key, FORCE, the grants, the triggers and the right are written by hand.
--
-- **Fits the version before it**: it reads neither the table nor the right.
CREATE TYPE "public"."access_request_channel" AS ENUM('letter', 'email', 'phone', 'in_person', 'other');--> statement-breakpoint
CREATE TYPE "public"."access_request_status" AS ENUM('open', 'answered');--> statement-breakpoint
CREATE TYPE "public"."personal_subject" AS ENUM('customer', 'contact', 'prospect', 'person');--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject" "personal_subject" NOT NULL,
	"customer_id" uuid,
	"contact_id" uuid,
	"prospect_id" uuid,
	"person_id" uuid,
	"received_on" date NOT NULL,
	"channel" "access_request_channel" NOT NULL,
	"status" "access_request_status" DEFAULT 'open' NOT NULL,
	"answer_due_on" date NOT NULL,
	"produced_at" timestamp with time zone,
	"produced_by" text,
	"answered_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "access_requests_one_subject" CHECK (num_nonnulls("access_requests"."customer_id", "access_requests"."contact_id", "access_requests"."prospect_id", "access_requests"."person_id") <= 1
        and ("access_requests"."customer_id" is null or "access_requests"."subject" = 'customer')
        and ("access_requests"."contact_id" is null or "access_requests"."subject" = 'contact')
        and ("access_requests"."prospect_id" is null or "access_requests"."subject" = 'prospect')
        and ("access_requests"."person_id" is null or "access_requests"."subject" = 'person')),
	CONSTRAINT "access_requests_stand" CHECK (("access_requests"."status" = 'open' and "access_requests"."answered_at" is null)
        or ("access_requests"."status" = 'answered' and "access_requests"."answered_at" is not null and "access_requests"."produced_at" is not null)),
	CONSTRAINT "access_requests_produced_by_somebody" CHECK (("access_requests"."produced_at" is null) = ("access_requests"."produced_by" is null)),
	CONSTRAINT "access_requests_answer_after" CHECK ("access_requests"."answer_due_on" >= "access_requests"."received_on")
);
--> statement-breakpoint
ALTER TABLE "access_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_prospect_in_tenant" FOREIGN KEY ("tenant_id","prospect_id") REFERENCES "public"."prospects"("tenant_id","id") ON DELETE SET NULL ("prospect_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_person_in_tenant" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_one_open_customer" ON "access_requests" USING btree ("tenant_id","customer_id") WHERE "access_requests"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_one_open_contact" ON "access_requests" USING btree ("tenant_id","contact_id") WHERE "access_requests"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_one_open_prospect" ON "access_requests" USING btree ("tenant_id","prospect_id") WHERE "access_requests"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_one_open_person" ON "access_requests" USING btree ("tenant_id","person_id") WHERE "access_requests"."status" = 'open';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "access_requests" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("access_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("access_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "access_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "access_requests" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("status", "produced_at", "produced_by", "answered_at", "updated_at") ON "access_requests" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "access_requests"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "access_requests_record_author" BEFORE INSERT ON "access_requests"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();--> statement-breakpoint
CREATE FUNCTION "access_request_moves_on"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	-- The key of a lead that went under the deletion concept, by its foreign key.
	IF old.prospect_id IS NOT NULL AND new.prospect_id IS NULL
	   AND to_jsonb(new) - 'prospect_id' IS NOT DISTINCT FROM to_jsonb(old) - 'prospect_id' THEN
		RETURN new;
	END IF;

	IF to_jsonb(new) - ARRAY['status', 'produced_at', 'produced_by', 'answered_at', 'updated_at']
	   IS DISTINCT FROM to_jsonb(old) - ARRAY['status', 'produced_at', 'produced_by', 'answered_at', 'updated_at'] THEN
		RAISE EXCEPTION 'An einer Auskunftsanfrage ändert sich nur, wann die Auskunft erstellt und wann sie beantwortet wurde.'
			USING ERRCODE = 'OG001';
	END IF;

	IF new.produced_at IS DISTINCT FROM old.produced_at THEN
		IF new.produced_at IS NULL THEN
			RAISE EXCEPTION 'Dass eine Auskunft erstellt wurde, bleibt stehen.'
				USING ERRCODE = 'OG001';
		END IF;

		new.produced_by := nullif(current_setting('app.user_id', true), '');
	ELSIF new.produced_by IS DISTINCT FROM old.produced_by THEN
		RAISE EXCEPTION 'Wer eine Auskunft erstellt hat, folgt aus dem Erstellen.'
			USING ERRCODE = 'OG001';
	END IF;

	IF old.status::text = 'answered'
	   AND (new.status::text <> 'answered' OR new.answered_at IS DISTINCT FROM old.answered_at) THEN
		RAISE EXCEPTION 'Eine beantwortete Auskunftsanfrage bleibt beantwortet.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "access_requests_move_on" BEFORE UPDATE ON "access_requests"
	FOR EACH ROW EXECUTE FUNCTION "access_request_moves_on"();--> statement-breakpoint
CREATE FUNCTION "access_request_contact_in_tenant"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.contact_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM public.contacts k WHERE k.id = new.contact_id AND k.tenant_id = new.tenant_id) THEN
		RAISE EXCEPTION 'Der Ansprechpartner gehört nicht zu diesem Betrieb.'
			USING ERRCODE = 'OG001';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "access_requests_contact_in_tenant" BEFORE INSERT ON "access_requests"
	FOR EACH ROW EXECUTE FUNCTION "access_request_contact_in_tenant"();--> statement-breakpoint
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'privacy.access')
 WHERE "key" = 'owner' AND NOT ('privacy.access' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
