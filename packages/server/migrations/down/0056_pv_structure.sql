-- Rolling the PV structure of #300 back to how 0055 left the schema.
--
-- What it costs an installation that runs it: the power of every inverter and
-- module, the MPP inputs, where each string faces and how steep it is, and
-- which battery, meter or wallbox belongs to which PV system, with the
-- columns. The inverters, strings and modules themselves stay. A deletion
-- follows the electrical structure down again, as 0030 wrote it, and no
-- longer the PV structure; rows marked as deleted stay marked.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the columns, the same choice as in every earlier rollback.
DROP TRIGGER IF EXISTS "structure_follows_deletion" ON "pv_strings";--> statement-breakpoint
DROP TRIGGER IF EXISTS "structure_follows_deletion" ON "inverters";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mark_structure_deleted"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'installations' THEN
		UPDATE public.distribution_boards SET deleted_at = new.deleted_at
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
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "pv_links_follow" ON "inverters";--> statement-breakpoint
DROP TRIGGER IF EXISTS "pv_links_follow" ON "installations";--> statement-breakpoint
DROP FUNCTION IF EXISTS "pv_links_follow"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "installations_pv_link_holds" ON "installations";--> statement-breakpoint
DROP FUNCTION IF EXISTS "pv_link_holds"();--> statement-breakpoint
ALTER TABLE "pv_strings" DROP CONSTRAINT "pv_strings_tilt";--> statement-breakpoint
ALTER TABLE "pv_strings" DROP CONSTRAINT "pv_strings_azimuth";--> statement-breakpoint
ALTER TABLE "pv_strings" DROP CONSTRAINT "pv_strings_mpp_input";--> statement-breakpoint
ALTER TABLE "pv_modules" DROP CONSTRAINT "pv_modules_rated_power";--> statement-breakpoint
ALTER TABLE "inverters" DROP CONSTRAINT "inverters_mpp_inputs";--> statement-breakpoint
ALTER TABLE "inverters" DROP CONSTRAINT "inverters_rated_power";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_not_own_system";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_inverter_with_system";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_inverter_in_tenant";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_pv_system_in_tenant";--> statement-breakpoint
ALTER TABLE "pv_strings" DROP COLUMN "tilt_deg";--> statement-breakpoint
ALTER TABLE "pv_strings" DROP COLUMN "azimuth_deg";--> statement-breakpoint
ALTER TABLE "pv_strings" DROP COLUMN "mpp_input";--> statement-breakpoint
ALTER TABLE "pv_modules" DROP COLUMN "rated_power_w";--> statement-breakpoint
ALTER TABLE "inverters" DROP COLUMN "mpp_inputs";--> statement-breakpoint
ALTER TABLE "inverters" DROP COLUMN "rated_power_w";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "inverter_id";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "pv_system_id";
