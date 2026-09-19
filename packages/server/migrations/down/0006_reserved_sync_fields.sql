-- Taking a value back out of an enum is not something PostgreSQL offers, so
-- the type is rebuilt without it.
--
-- A row that already carries the value blocks the cast, and that is the right
-- way round. A recorded conflict is a record of something that happened; the
-- rollback would have to rewrite it into a reason that was not the reason, and
-- failing loudly beats that.
ALTER TABLE "sync_conflicts" ALTER COLUMN "reason" TYPE text;--> statement-breakpoint
DROP TYPE "public"."conflict_reason";--> statement-breakpoint
CREATE TYPE "public"."conflict_reason" AS ENUM('changed_elsewhere', 'record_is_fixed', 'online_only', 'record_missing', 'unknown_entity');--> statement-breakpoint
ALTER TABLE "sync_conflicts" ALTER COLUMN "reason" TYPE "public"."conflict_reason" USING "reason"::"public"."conflict_reason";
