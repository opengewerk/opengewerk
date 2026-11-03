CREATE TYPE "public"."reminder_ground" AS ENUM('consent', 'existing_customer', 'objected');--> statement-breakpoint
ALTER TYPE "public"."mail_kind" ADD VALUE 'customer_reminder';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'customer_reminder.mail' BEFORE 'emergency.night_from_minute';--> statement-breakpoint
ALTER TYPE "public"."mail_occasion" ADD VALUE 'due_reminder';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reminder_ground" "reminder_ground";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reminder_ground_on" date;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_reminder_ground_on" CHECK (("customers"."reminder_ground" is null) = ("customers"."reminder_ground_on" is null));