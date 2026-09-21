-- The ZUGFeRD PDF, the second half of issue #75.
--
-- A ZUGFeRD PDF is a file of an issued document like its PDF and its
-- XRechnung, made the first time somebody asks for it and never again, so it
-- is a third purpose of `document_files`.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing here does.
ALTER TYPE "public"."document_file_purpose" ADD VALUE 'zugferd';
