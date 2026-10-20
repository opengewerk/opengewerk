-- Takes the person of a conflict out again, back to how 0081 left things: the
-- code that lists and closes a conflict by its device alone comes back with
-- the image of before.
--
-- Run as the superuser, like every rollback.
ALTER TABLE "sync_conflicts" DROP COLUMN IF EXISTS "user_id";
