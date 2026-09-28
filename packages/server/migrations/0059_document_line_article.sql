-- The article a document line was taken from, #296. A pointer and nothing
-- more: text, unit and price belong to the line from the moment it is taken,
-- and a changed article changes no document. It is what the articles of the
-- last 90 days on the devices are counted from, and what gives a line of a
-- report its price on the invoice made from it. An article is only ever
-- marked as deleted, so the key needs no action on delete. The grants on
-- document_lines are on the whole table and cover the new column; the audit
-- and sync triggers see it without a change. Nothing is written to a row.

ALTER TABLE "document_lines" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_article_in_tenant" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_lines_article_idx" ON "document_lines" USING btree ("tenant_id","article_id");
