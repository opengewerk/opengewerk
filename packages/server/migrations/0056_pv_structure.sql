-- The PV structure, #300: the figures of inverters, strings and modules, and
-- the installations that belong to a PV system. A battery, a meter or a
-- wallbox names its system and, where it hangs at one, its inverter.
--
-- Everything down to the checks comes from the schema. What follows is written
-- by hand. First the trigger that holds what the keys cannot: only those three
-- kinds belong to a system, the system is a PV system at the same site, and
-- the inverter is one of its own. The sync and the routes ask the same first
-- (`pvLinkRefusal`, and the rules in `record-rules.ts`), so that a device gets
-- a conflict about one operation and not a refused transmission.
--
-- Then the other direction. A system that stops being one or moves to another
-- site lets go of what belonged to it, and an inverter that moves to another
-- system lets go of what hung at it. The links are cleared, not refused: they
-- describe the building and are set again in a moment, where a refusal would
-- stop the change that caused it, on a device, for a reason it cannot see.
--
-- Last, the deletion that follows the electrical structure down follows the PV
-- structure as well, from the system to its inverters, strings and modules,
-- and lets go of the links on the way.
ALTER TABLE "installations" ADD COLUMN "pv_system_id" uuid;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "inverter_id" uuid;--> statement-breakpoint
ALTER TABLE "inverters" ADD COLUMN "rated_power_w" integer;--> statement-breakpoint
ALTER TABLE "inverters" ADD COLUMN "mpp_inputs" integer;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD COLUMN "rated_power_w" integer;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "mpp_input" integer;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "azimuth_deg" integer;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD COLUMN "tilt_deg" integer;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_pv_system_in_tenant" FOREIGN KEY ("tenant_id","pv_system_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_inverter_in_tenant" FOREIGN KEY ("tenant_id","inverter_id") REFERENCES "public"."inverters"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_inverter_with_system" CHECK ("installations"."inverter_id" is null or "installations"."pv_system_id" is not null);--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_not_own_system" CHECK ("installations"."pv_system_id" is null or "installations"."pv_system_id" <> "installations"."id");--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_rated_power" CHECK ("inverters"."rated_power_w" is null or "inverters"."rated_power_w" between 1 and 10000000);--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_mpp_inputs" CHECK ("inverters"."mpp_inputs" is null or "inverters"."mpp_inputs" between 1 and 24);--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_rated_power" CHECK ("pv_modules"."rated_power_w" is null or "pv_modules"."rated_power_w" between 1 and 2000);--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_mpp_input" CHECK ("pv_strings"."mpp_input" is null or "pv_strings"."mpp_input" between 1 and 24);--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_azimuth" CHECK ("pv_strings"."azimuth_deg" is null or "pv_strings"."azimuth_deg" between 0 and 359);--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_tilt" CHECK ("pv_strings"."tilt_deg" is null or "pv_strings"."tilt_deg" between 0 and 90);--> statement-breakpoint
-- Under the policy of the business: a system or an inverter of another
-- business is not found here, and the keys over tenant and id answer for it.
CREATE FUNCTION "pv_link_holds"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.pv_system_id IS NULL THEN
		RETURN new;
	END IF;
	-- The kinds of `pvCompanionKinds` in the domain.
	IF new.kind NOT IN ('battery', 'meter', 'wallbox') THEN
		RAISE EXCEPTION 'Zu einer PV-Anlage gehören nur Speicher, Zähler und Wallbox.'
			USING ERRCODE = 'check_violation';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM installations
			WHERE id = new.pv_system_id AND tenant_id = new.tenant_id AND kind = 'pv_system'
				AND site_id = new.site_id AND deleted_at IS NULL
	) THEN
		RAISE EXCEPTION 'Die PV-Anlage steht nicht an diesem Objekt.'
			USING ERRCODE = 'check_violation';
	END IF;
	IF new.inverter_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM inverters
			WHERE id = new.inverter_id AND tenant_id = new.tenant_id
				AND installation_id = new.pv_system_id AND deleted_at IS NULL
	) THEN
		RAISE EXCEPTION 'Der Wechselrichter gehört nicht zu dieser PV-Anlage.'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "installations_pv_link_holds" BEFORE INSERT OR UPDATE OF "pv_system_id", "inverter_id", "kind", "site_id" ON "installations"
	FOR EACH ROW EXECUTE FUNCTION "pv_link_holds"();--> statement-breakpoint
CREATE FUNCTION "pv_links_follow"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_table_name = 'installations' THEN
		IF old.kind = 'pv_system' AND (new.kind <> 'pv_system' OR new.site_id <> old.site_id) THEN
			UPDATE public.installations SET pv_system_id = NULL, inverter_id = NULL
			 WHERE pv_system_id = new.id AND deleted_at IS NULL;
		END IF;
	ELSIF tg_table_name = 'inverters' THEN
		IF new.installation_id <> old.installation_id THEN
			UPDATE public.installations SET inverter_id = NULL
			 WHERE inverter_id = new.id AND deleted_at IS NULL;
		END IF;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pv_links_follow" AFTER UPDATE OF "kind", "site_id" ON "installations"
	FOR EACH ROW EXECUTE FUNCTION "pv_links_follow"();--> statement-breakpoint
CREATE TRIGGER "pv_links_follow" AFTER UPDATE OF "installation_id" ON "inverters"
	FOR EACH ROW EXECUTE FUNCTION "pv_links_follow"();--> statement-breakpoint
-- What belonged to a system lets go of it before its inverters are marked:
-- a link to one of them would no longer hold, and the trigger above would
-- refuse the deletion over it.
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
$$;--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "inverters"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_deleted"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "pv_strings"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_deleted"();
