-- The QR labels of the installations, #308: a sticker in the meter cabinet
-- or on the inverter whose scan opens the installation. One row for each label
-- that was made, valid or blocked; the code is random and stands once in the
-- whole instance, and an installation has at most one valid label.
--
-- Everything down to the policy comes from the schema. What follows is
-- written by hand: FORCE, the grants, the audit and sync triggers, the trigger
-- that keeps a blocked label blocked, and the labels in
-- `mark_structure_deleted`, so that a deleted installation takes its labels
-- with it. No row of an existing table changes.
--
-- The application may read and insert labels, block one and mark it deleted.
-- It may not change the code or the installation of a label: a label is
-- printed, and what it says stays.

CREATE TABLE "installation_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "installation_labels_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "installation_labels_code_shaped" CHECK ("installation_labels"."code" ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$')
);
--> statement-breakpoint
ALTER TABLE "installation_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installation_labels" ADD CONSTRAINT "installation_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_labels" ADD CONSTRAINT "installation_labels_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "installation_labels_code_once" ON "installation_labels" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_labels_one_valid" ON "installation_labels" USING btree ("tenant_id","installation_id") WHERE "installation_labels"."blocked_at" is null and "installation_labels"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "installation_labels_installation_idx" ON "installation_labels" USING btree ("tenant_id","installation_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "installation_labels" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("installation_labels"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("installation_labels"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "installation_labels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "installation_labels" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("blocked_at", "deleted_at") ON "installation_labels" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "installation_labels"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "installation_labels"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE FUNCTION "keep_label_blocked"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.blocked_at IS NOT NULL AND new.blocked_at IS DISTINCT FROM old.blocked_at THEN
		RAISE EXCEPTION 'Ein gesperrtes Etikett bleibt gesperrt.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "installation_labels_blocked_stays" BEFORE UPDATE OF "blocked_at" ON "installation_labels"
	FOR EACH ROW EXECUTE FUNCTION "keep_label_blocked"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mark_structure_deleted"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'installations' THEN
		UPDATE public.installations SET pv_system_id = NULL, inverter_id = NULL
		 WHERE pv_system_id = new.id AND deleted_at IS NULL;
		UPDATE public.distribution_boards SET deleted_at = new.deleted_at
		 WHERE installation_id = new.id AND deleted_at IS NULL;
		UPDATE public.inverters SET deleted_at = new.deleted_at
		 WHERE installation_id = new.id AND deleted_at IS NULL;
		UPDATE public.installation_labels SET deleted_at = new.deleted_at
		 WHERE installation_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'distribution_boards' THEN
		UPDATE public.board_sections SET deleted_at = new.deleted_at
		 WHERE distribution_board_id = new.id AND deleted_at IS NULL;
		UPDATE public.circuits SET deleted_at = new.deleted_at
		 WHERE distribution_board_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'board_sections' THEN
		UPDATE public.circuits SET deleted_at = new.deleted_at
		 WHERE board_section_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'circuits' THEN
		UPDATE public.equipment SET deleted_at = new.deleted_at
		 WHERE circuit_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'inverters' THEN
		UPDATE public.installations SET inverter_id = NULL
		 WHERE inverter_id = new.id AND deleted_at IS NULL;
		UPDATE public.pv_strings SET deleted_at = new.deleted_at
		 WHERE inverter_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'pv_strings' THEN
		UPDATE public.pv_modules SET deleted_at = new.deleted_at
		 WHERE pv_string_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;
