-- Job numbers, #145: a number range for jobs next to the ones for documents.
--
-- One value more in the enum and nothing else. The range itself is created on
-- first use, like every other one, which is also why this migration does not
-- touch a row: all pending migrations run in one transaction, and a new enum
-- value may not be used in the transaction that adds it. Jobs created before
-- this keep their empty number; the numbering starts with the next one.

ALTER TYPE "public"."number_range_key" ADD VALUE 'job' BEFORE 'quote';
