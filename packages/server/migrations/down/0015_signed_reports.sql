-- Rolling signed reports back.
--
-- What it costs an installation that runs it: every signature is gone with its
-- table, and a document that was signed and not yet issued is a draft again,
-- because the state it was in no longer exists. It can be changed after that,
-- which is exactly what the signature was there to prevent; a rollback that
-- keeps the state would have to keep the table, and then it is not one. An
-- issued report keeps its snapshot, and with it the signature as it was
-- printed, and a PDF already stored stays the PDF that was sent.
--
-- The audit log keeps its entries about `document_signatures`, the same choice
-- as in every earlier rollback.

DROP TRIGGER IF EXISTS "document_signatures_sign_the_document" ON "document_signatures";--> statement-breakpoint
DROP TRIGGER IF EXISTS "document_signatures_stay_as_written" ON "document_signatures";--> statement-breakpoint
DROP TRIGGER IF EXISTS "stamp_sync_columns" ON "document_signatures";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "document_signatures";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "document_signatures";--> statement-breakpoint
DROP TABLE IF EXISTS "document_signatures";--> statement-breakpoint
DROP FUNCTION IF EXISTS "sign_document"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "signature_stays_as_written"();--> statement-breakpoint

-- The version from 0004, word for word.
CREATE OR REPLACE FUNCTION "document_stays_fixed"() RETURNS trigger AS $$
DECLARE
	bookkeeping text[] := ARRAY['status', 'updated_at', 'updated_by', 'device_id',
		'version', 'change_sequence'];
BEGIN
	IF tg_op = 'DELETE' THEN
		IF old.status <> 'draft' THEN
			RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht gelöscht, sondern storniert.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN old;
	END IF;

	IF old.status = 'draft' THEN
		RETURN new;
	END IF;

	IF old.status = 'issued' AND new.status = 'cancelled' THEN
		IF to_jsonb(new) - bookkeeping IS DISTINCT FROM to_jsonb(old) - bookkeeping THEN
			RAISE EXCEPTION 'Beim Stornieren darf sich außer dem Status nichts ändern.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN new;
	END IF;

	RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht geändert, sondern storniert und neu ausgestellt.'
		USING ERRCODE = 'OG001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- The type without 'signed'. PostgreSQL has no way to remove a value from an
-- enum, so the type is built anew and the column moved across. Changing the
-- type rewrites the table without firing a row trigger, so the rule above does
-- not stand in the way of turning a signed document back into a draft.
ALTER TABLE "documents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."document_status" RENAME TO "document_status_old";--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'issued', 'cancelled');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" TYPE "public"."document_status"
	USING (CASE "status"::text WHEN 'signed' THEN 'draft' ELSE "status"::text END)::"public"."document_status";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
DROP TYPE "public"."document_status_old";
