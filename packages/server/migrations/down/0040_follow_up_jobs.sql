-- Rolling follow-up jobs back to how 0039 left them.
--
-- What it costs an installation that runs it: which job follows which is gone
-- with the column. The jobs themselves stay, each as a job of its own.
--
-- Run as the superuser, like every rollback.

DROP TRIGGER "jobs_follow_finished_jobs" ON "jobs";--> statement-breakpoint
DROP FUNCTION "job_follows_finished_job"();--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_not_own_predecessor";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_predecessor_in_tenant";--> statement-breakpoint
DROP INDEX "jobs_predecessor_idx";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "predecessor_job_id";
