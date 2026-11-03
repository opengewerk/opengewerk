CREATE TYPE "public"."mail_occasion" AS ENUM('appointment_arranged', 'appointment_moved', 'appointment_cancelled', 'job_received');--> statement-breakpoint
ALTER TYPE "public"."mail_kind" ADD VALUE 'appointment_confirmation';--> statement-breakpoint
ALTER TYPE "public"."mail_kind" ADD VALUE 'job_received';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'appointment.mail_to_customer' BEFORE 'emergency.night_from_minute';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'service_call.mail_on_receipt' BEFORE 'emergency.night_from_minute';--> statement-breakpoint
ALTER TYPE "public"."snippet_purpose" ADD VALUE 'mail';--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "text_snippets" ADD COLUMN "mail_occasion" "mail_occasion";--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_appointment_in_tenant" FOREIGN KEY ("tenant_id","appointment_id") REFERENCES "public"."appointments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_appointment_idx" ON "mail_outbox" USING btree ("tenant_id","appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "text_snippets_one_per_occasion" ON "text_snippets" USING btree ("tenant_id","mail_occasion") WHERE "text_snippets"."mail_occasion" is not null;