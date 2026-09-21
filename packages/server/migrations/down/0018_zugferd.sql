-- Rolling back the ZUGFeRD PDF.
--
-- The enum value is taken out the only way PostgreSQL offers, by building the
-- type anew without it. A row that already carries it blocks the cast, and
-- that is the right way round: a ZUGFeRD PDF that was stored went out to a
-- customer, and a rollback that quietly dropped it would rewrite what
-- happened. Changing the type rewrites the table without firing a row
-- trigger, so the rule that keeps `document_files` as written does not stand
-- in the way where no such row exists.
ALTER TABLE "document_files" ALTER COLUMN "purpose" TYPE text;--> statement-breakpoint
DROP TYPE "public"."document_file_purpose";--> statement-breakpoint
CREATE TYPE "public"."document_file_purpose" AS ENUM('pdf', 'xrechnung');--> statement-breakpoint
ALTER TABLE "document_files" ALTER COLUMN "purpose" TYPE "public"."document_file_purpose" USING "purpose"::"public"."document_file_purpose";
