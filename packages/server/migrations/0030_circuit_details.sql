-- The structure below an installation, made usable: #70.
--
-- The statements down to the checks come from the schema, reordered by hand
-- so that the unique keys exist before the foreign keys that point at them.
-- Everything after the checks is written by hand.
--
-- **What a circuit carries.** Section 3.2 of the concept lists it: the
-- protective device with its characteristic and rated current, the RCD with
-- its type and rated residual current, the cable with type, cores, cross
-- section, length and installation method, and what the circuit supplies.
-- Figures are thousandths, like the quantity of a document line, and every
-- one of them may be empty: a circuit written down in front of a board is a
-- designation first. The checks hold the bounds of `circuitProblems` in
-- `domain` for every way in that is not the sync, which asks that function
-- first and refuses a figure out of bounds as one operation, not with the
-- whole transmission.
--
-- **Parents in the same business.** PostgreSQL checks a foreign key past row
-- level security. With a key on the id alone, a device of one business that
-- sent the id of another business's board had its circuit accepted under
-- that board. The four keys of the structure now run over the tenant as well,
-- against unique keys over tenant and id on the parents. On an installation
-- where a row already hangs across two businesses, adding the key fails and,
-- since every pending migration runs in one transaction, the update stops
-- with the database as it was; that is a case for a person, not for a
-- migration that quietly moves the row somewhere.
--
-- **Removing a section.** The key from a circuit to its section was written
-- with `ON DELETE SET NULL` and no column list, and without one PostgreSQL
-- empties every column of the key, the board included, which `not null`
-- refuses: a section with circuits could not be removed at all, and neither
-- could a board or an installation above one. Nothing in the application
-- removes a row, rows are marked, so it never showed. Now only the section
-- is emptied and the circuit stays on its board.
--
-- **Marked as deleted, all the way down.** Rows are marked and not removed,
-- so the cascades of the keys never run, and a board marked as deleted used
-- to leave its circuits standing: invisible under a board nobody lists any
-- more, and still delivered to every device. The trigger at the end marks
-- what hangs below a part in the same statement that marks the part, with
-- the same moment, so the change stream and the audit log carry each row.
-- It runs as whoever marks, and row level security narrows it to the one
-- business, which the keys above make the whole of the structure anyway.
-- The photovoltaic structure below an installation is not taken along yet;
-- it gets its screens and this rule with phase 2.
CREATE TYPE "public"."cable_installation_method" AS ENUM('a1', 'a2', 'b1', 'b2', 'c', 'd1', 'd2', 'e', 'f', 'g');--> statement-breakpoint
CREATE TYPE "public"."overcurrent_device" AS ENUM('circuit_breaker', 'rcbo', 'fuse_d', 'fuse_d0', 'fuse_nh');--> statement-breakpoint
CREATE TYPE "public"."rcd_type" AS ENUM('ac', 'a', 'a_ev', 'f', 'b', 'b_plus');--> statement-breakpoint
CREATE TYPE "public"."trip_characteristic" AS ENUM('b', 'c', 'd', 'k', 'z', 'gg', 'am');--> statement-breakpoint
ALTER TABLE "board_sections" DROP CONSTRAINT "board_sections_distribution_board_id_distribution_boards_id_fk";
--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_distribution_board_id_distribution_boards_id_fk";
--> statement-breakpoint
ALTER TABLE "distribution_boards" DROP CONSTRAINT "distribution_boards_installation_id_installations_id_fk";
--> statement-breakpoint
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_circuit_id_circuits_id_fk";
--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "consumer" text;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "overcurrent_device" "overcurrent_device";--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "trip_characteristic" "trip_characteristic";--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "rated_current_milli" integer;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "rcd_type" "rcd_type";--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "rated_residual_current_milli" integer;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "cable_type" text;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "cable_cores" integer;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "cable_cross_section_milli" integer;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "cable_length_milli" integer;--> statement-breakpoint
ALTER TABLE "circuits" ADD COLUMN "cable_installation_method" "cable_installation_method";--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_board_in_tenant" FOREIGN KEY ("tenant_id","distribution_board_id") REFERENCES "public"."distribution_boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_board_in_tenant" FOREIGN KEY ("tenant_id","distribution_board_id") REFERENCES "public"."distribution_boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_circuit_in_tenant" FOREIGN KEY ("tenant_id","circuit_id") REFERENCES "public"."circuits"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_rated_current" CHECK ("circuits"."rated_current_milli" is null or "circuits"."rated_current_milli" between 1 and 6300000);--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_rated_residual_current" CHECK ("circuits"."rated_residual_current_milli" is null or "circuits"."rated_residual_current_milli" between 1 and 30000);--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_cable_cores" CHECK ("circuits"."cable_cores" is null or "circuits"."cable_cores" between 1 and 100);--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_cable_cross_section" CHECK ("circuits"."cable_cross_section_milli" is null or "circuits"."cable_cross_section_milli" between 1 and 1000000);--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_cable_length" CHECK ("circuits"."cable_length_milli" is null or "circuits"."cable_length_milli" between 1 and 100000000);--> statement-breakpoint

ALTER TABLE "circuits" DROP CONSTRAINT "circuits_section_belongs_to_board";--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_section_belongs_to_board" FOREIGN KEY ("board_section_id","distribution_board_id") REFERENCES "public"."board_sections"("id","distribution_board_id") ON DELETE SET NULL ("board_section_id") ON UPDATE no action;--> statement-breakpoint

-- One function for the four levels, asked which table it fires on. Four
-- functions would be four places to forget the next level in.
CREATE FUNCTION "mark_structure_deleted"() RETURNS trigger
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

CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "installations"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_deleted"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "distribution_boards"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_deleted"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "board_sections"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_deleted"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "circuits"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_deleted"();
