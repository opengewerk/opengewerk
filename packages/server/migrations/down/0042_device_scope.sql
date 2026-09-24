-- Rolling each device's part of the business back to how 0041 left them.
--
-- What it costs an installation that runs it: who is on which job, and the
-- day each job was closed. Every device gets the whole business again at its
-- next exchange, which is how it was before.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.

DROP TRIGGER "jobs_stamp_closed_at" ON "jobs";--> statement-breakpoint
DROP FUNCTION "stamp_closed_at"();--> statement-breakpoint
DROP TABLE "job_assignments";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "closed_at";
