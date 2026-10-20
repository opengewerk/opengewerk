-- Takes the table of who stored a file out again, back to how 0082 left
-- things: the code that lets a record name any file of the business comes back
-- with the image of before.
--
-- Run as the superuser, like every rollback.
DROP TABLE IF EXISTS "file_uploads";
