-- Rolling the QR labels of #308 back to how 0056 left the schema.
--
-- What it costs an installation that runs it: every label that was made, with
-- its code. A label on a cabinet then opens nothing any more, as if it were
-- blocked, and a new one printed after an update carries a new code. A
-- deletion follows the structure down as 0056 wrote it.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.
DROP TABLE "installation_labels";--> statement-breakpoint
DROP FUNCTION "keep_label_blocked"();--> statement-breakpoint
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
$$;
