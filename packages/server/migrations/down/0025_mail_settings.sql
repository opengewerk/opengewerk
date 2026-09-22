-- Rolling back the mail server of each business.
--
-- The settings go, and the sealed passwords with them. A rollback does not
-- bring the .env variables back; an installation that goes back to the
-- version before this one sets them up there again.
DROP TABLE IF EXISTS "secrets";--> statement-breakpoint
DROP TABLE IF EXISTS "mail_settings";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."secret_purpose";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mail_security";
