-- Takes the second factor of a session out again, back to how 0080 left
-- things: the code that reads it off the account comes back with the image
-- of before. The sessions that ended with the update stay ended.
--
-- Run as the superuser, like every rollback.
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "second_factor";
