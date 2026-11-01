-- Takes back 0111 (#290). The appointments and who goes to them go; the
-- value `appointment` stays in `push_kind`, since a value cannot be taken out
-- of an enum and an unused one does no harm (as in the rollback of 0071).
DROP TABLE "appointment_people";--> statement-breakpoint
DROP TABLE "appointments";
