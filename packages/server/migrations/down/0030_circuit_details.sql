-- Rolling back the details of a circuit and the keys that hold the structure
-- in its business.
--
-- What it costs an installation that runs it: every circuit loses what was
-- entered about its protective device, its RCD, its cable and what it
-- supplies, with the columns. The boards, sections, circuits and equipment
-- themselves stay, hanging on their parents by id again, which is the state
-- before and has the gap described in the migration. Rows marked as deleted
-- stay marked; the rollback does not bring anything back.
DROP TRIGGER IF EXISTS "structure_follows_deletion" ON "circuits";--> statement-breakpoint
DROP TRIGGER IF EXISTS "structure_follows_deletion" ON "board_sections";--> statement-breakpoint
DROP TRIGGER IF EXISTS "structure_follows_deletion" ON "distribution_boards";--> statement-breakpoint
DROP TRIGGER IF EXISTS "structure_follows_deletion" ON "installations";--> statement-breakpoint
DROP FUNCTION IF EXISTS "mark_structure_deleted"();--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_section_belongs_to_board";--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_section_belongs_to_board" FOREIGN KEY ("board_section_id","distribution_board_id") REFERENCES "public"."board_sections"("id","distribution_board_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_cable_length";--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_cable_cross_section";--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_cable_cores";--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_rated_residual_current";--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_rated_current";--> statement-breakpoint
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_circuit_in_tenant";--> statement-breakpoint
ALTER TABLE "distribution_boards" DROP CONSTRAINT "distribution_boards_installation_in_tenant";--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_board_in_tenant";--> statement-breakpoint
ALTER TABLE "board_sections" DROP CONSTRAINT "board_sections_board_in_tenant";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_tenant_id_key";--> statement-breakpoint
ALTER TABLE "distribution_boards" DROP CONSTRAINT "distribution_boards_tenant_id_key";--> statement-breakpoint
ALTER TABLE "circuits" DROP CONSTRAINT "circuits_tenant_id_key";--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_distribution_board_id_distribution_boards_id_fk" FOREIGN KEY ("distribution_board_id") REFERENCES "public"."distribution_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_distribution_board_id_distribution_boards_id_fk" FOREIGN KEY ("distribution_board_id") REFERENCES "public"."distribution_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_circuit_id_circuits_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."circuits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "cable_installation_method";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "cable_length_milli";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "cable_cross_section_milli";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "cable_cores";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "cable_type";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "rated_residual_current_milli";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "rcd_type";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "rated_current_milli";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "trip_characteristic";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "overcurrent_device";--> statement-breakpoint
ALTER TABLE "circuits" DROP COLUMN "consumer";--> statement-breakpoint
DROP TYPE "public"."trip_characteristic";--> statement-breakpoint
DROP TYPE "public"."rcd_type";--> statement-breakpoint
DROP TYPE "public"."overcurrent_device";--> statement-breakpoint
DROP TYPE "public"."cable_installation_method";
