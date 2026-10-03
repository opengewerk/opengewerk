-- Rolling the deadline engine of the foundation back to how 0066 left the
-- database.
--
-- What it costs an installation that runs it: when the engine last went
-- through each business, which it writes again on its next pass, and any
-- interval in months a business set, which no kind of this version counts in.
--
-- The rows of `deadline_runs` carry no audit trigger, and dropping a table or a
-- column writes nothing in any log. No route of this version writes a value
-- into `interval_months`, so the column goes without one.

DROP TABLE "deadline_runs";--> statement-breakpoint
ALTER TABLE "deadline_settings" DROP CONSTRAINT "deadline_settings_one_unit";--> statement-breakpoint
ALTER TABLE "deadline_settings" DROP CONSTRAINT "deadline_settings_interval_months_in_bounds";--> statement-breakpoint
ALTER TABLE "deadline_settings" DROP COLUMN "interval_months";
