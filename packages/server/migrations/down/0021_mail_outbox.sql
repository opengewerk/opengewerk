-- Rolling back the mail outbox.
--
-- What it costs an installation that runs it: every message the instance sent
-- or meant to send, with the day it went out. The audit log keeps its entries
-- for the rows, as it keeps everything.
DROP FUNCTION IF EXISTS "every_tenant"();--> statement-breakpoint
DROP TABLE IF EXISTS "mail_outbox";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mail_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mail_kind";
