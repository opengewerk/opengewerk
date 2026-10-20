-- Back to how 0085 left things: no function asks which files a business holds,
-- and the owner of the tables no longer reads `files`. What the sweep took out
-- of the store stays out; it was named by no row.
--
-- Run as the superuser, like every rollback.
DROP FUNCTION IF EXISTS "files_held"(text[]);--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "files";
