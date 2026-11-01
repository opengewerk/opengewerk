-- Takes back 0110 (#288). The absences, the days of leave of a year and the
-- holiday settings go, with their two types; the value `wednesday_before`
-- stays in `rule_unit`, since a value cannot be taken out of an enum and an
-- unused one does no harm (as in the rollback of 0071). The right
-- "Abwesenheiten pflegen" stays in the roles that have it, where it asks for
-- nothing any more.
DROP TABLE "absences";--> statement-breakpoint
DROP TABLE "leave_entitlements";--> statement-breakpoint
DROP TABLE "holiday_settings";--> statement-breakpoint
DROP TYPE "public"."absence_kind";--> statement-breakpoint
DROP TYPE "public"."absence_state";
