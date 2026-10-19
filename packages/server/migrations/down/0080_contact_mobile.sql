-- Takes the second number of a contact out again, back to how 0079 left
-- things. The numbers kept in it go with it.
--
-- Run as the superuser, like every rollback.
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "mobile";
