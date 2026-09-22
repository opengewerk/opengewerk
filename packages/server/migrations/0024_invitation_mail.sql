-- An invitation sent by mail instead of passed on by the office.
--
-- A message about an invitation names the invitation and nothing else. Its
-- text holds a placeholder where the link goes: the job makes the token at the
-- moment it sends, puts its hash on the invitation and the link into the mail,
-- so neither this table nor the audit log ever holds a way into a business.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing here does.

ALTER TYPE "public"."mail_kind" ADD VALUE 'invitation';--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_invitation_idx" ON "mail_outbox" USING btree ("tenant_id","invitation_id");