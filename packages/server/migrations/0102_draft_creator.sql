-- Deleting a draft (#786), decided on 30.10.2026: whoever made a draft may
-- delete it, somebody else's only whoever has the new right `document.delete`.
--
-- **`documents.created_by`**: the account that made a document, written by
-- the server and reserved in the sync. For the drafts there are, the change
-- log names it: the account of the first entry of each draft. Only drafts,
-- since only a draft is ever deleted, and a fixed document refuses any change
-- anyway. A draft the log names nobody for keeps null and is deleted only
-- with the right.
--
-- **`document.delete`** goes to the owner and the office of every business,
-- as the code gives it to them; a technician gets it where the owner says so.
--
-- Row level security is lifted on the two tables the statements write: an
-- installation migrates as the owner, and under FORCE the owner finds no row
-- (0029, 0095). The change log names the migration as the reason.
--
-- **Fits the version before it**: it reads neither the column nor the right.
ALTER TABLE "documents" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "documents" AS "d"
   SET "created_by" = "made"."user_id"
  FROM (
	SELECT DISTINCT ON ("record_id") "record_id", "user_id"
	  FROM "audit_entries"
	 WHERE "table_name" = 'documents' AND "operation" = 'insert' AND "user_id" IS NOT NULL
	 ORDER BY "record_id", "changed_at", "id"
  ) AS "made"
 WHERE "made"."record_id" = "d"."id" AND "d"."status" = 'draft';--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'document.delete')
 WHERE "key" IN ('owner', 'office') AND NOT ('document.delete' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
