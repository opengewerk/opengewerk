-- Service calls, #292: the mark of an urgent repair at a job, the request for
-- an early start a consumer signs at the door, and the message that brings the
-- instructions of a service call to its customer.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE and the grants, the two triggers every synced table
-- carries, who signed on whose device, and that only a service call for a
-- consumer gets a request for an early start.
--
-- **Why a table of its own.** The instructions of #109 hang on a document, and
-- a service call taken on the phone often has none before the work: the quote
-- is the call. The request is signed before the work begins, the report after
-- it, so it cannot be a signature under the report either. It is a row like a
-- signature, granted INSERT and nothing else; the server sends the
-- instructions with it to the customer, through the outbox.

ALTER TYPE "public"."mail_kind" ADD VALUE 'job_instructions';--> statement-breakpoint
CREATE TABLE "early_start_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"device_info" text,
	"path" text NOT NULL,
	"content_fingerprint" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "early_start_requests_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "early_start_requests_signer_named" CHECK (length(btrim("early_start_requests"."signer_name")) between 1 and 200),
	CONSTRAINT "early_start_requests_path_shape" CHECK ("early_start_requests"."path" ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$' and length("early_start_requests"."path") <= 40000),
	CONSTRAINT "early_start_requests_device_info_short" CHECK ("early_start_requests"."device_info" is null or length("early_start_requests"."device_info") <= 500)
);
--> statement-breakpoint
ALTER TABLE "early_start_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "urgent_repair" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "early_start_request_id" uuid;--> statement-breakpoint
ALTER TABLE "early_start_requests" ADD CONSTRAINT "early_start_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_start_requests" ADD CONSTRAINT "early_start_requests_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "early_start_requests_job_idx" ON "early_start_requests" USING btree ("tenant_id","job_id","signed_at");--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_early_start_request_in_tenant" FOREIGN KEY ("tenant_id","early_start_request_id") REFERENCES "public"."early_start_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_job_idx" ON "mail_outbox" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "mail_outbox_early_start_request_idx" ON "mail_outbox" USING btree ("tenant_id","early_start_request_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "early_start_requests" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("early_start_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("early_start_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);;--> statement-breakpoint

ALTER TABLE "early_start_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "early_start_requests" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "early_start_requests"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "early_start_requests"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- On whose device the customer signed, from the request and from nothing
-- else, as the author of a note (0045).
CREATE TRIGGER "early_start_requests_record_author" BEFORE INSERT ON "early_start_requests"
	FOR EACH ROW EXECUTE FUNCTION "record_note_author"();--> statement-breakpoint

-- A request for an early start belongs to a service call for a consumer: a
-- project is agreed on a quote that carries the instructions, and a business
-- has no right of withdrawal. The sync refuses it before, as a conflict; this
-- holds for every other way in. A job it cannot see is left to the key, which
-- refuses one of another business with its own name.
CREATE FUNCTION "early_start_for_service_call"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	call record;
BEGIN
	SELECT j.kind, c.is_business INTO call
	  FROM jobs j
	  JOIN customers c ON c.tenant_id = j.tenant_id AND c.id = j.customer_id
	 WHERE j.tenant_id = new.tenant_id AND j.id = new.job_id;

	IF NOT FOUND THEN
		RETURN new;
	END IF;

	IF call.kind <> 'service' OR call.is_business THEN
		RAISE EXCEPTION 'Ein Verlangen auf vorzeitigen Beginn gibt es nur bei einem Serviceeinsatz für einen Verbraucher.'
			USING ERRCODE = 'OG014';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "early_start_for_service_call" BEFORE INSERT ON "early_start_requests"
	FOR EACH ROW EXECUTE FUNCTION "early_start_for_service_call"();
