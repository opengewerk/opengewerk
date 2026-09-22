-- A document sent to its customer, the second part of #81.
--
-- A message about a document names the document and the file it carries: the
-- PDF, or the ZUGFeRD PDF or XRechnung of an e-invoice. The file is chosen when
-- the message is written, because that is when the office decides what the
-- customer gets, and made or read when it is sent, because the document keeps
-- exactly one of each and a customer who downloads an invoice and one who gets
-- it by mail must have the same bytes.
--
-- `requested_by` says who asked. The audit log knows it too, from the insert;
-- the column is there so that the screen of a document can say it without
-- reading the log.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing here does.

CREATE TYPE "public"."mail_attachment" AS ENUM('pdf', 'zugferd', 'xrechnung');--> statement-breakpoint
ALTER TYPE "public"."mail_kind" ADD VALUE 'document';--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "attachment" "mail_attachment";--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_document_idx" ON "mail_outbox" USING btree ("tenant_id","document_id");
