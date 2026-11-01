-- Takes back 0112 (#291). The function first, which reads the table, then the
-- table; every calendar subscribed to an address of it stops getting answers.
DROP FUNCTION IF EXISTS "calendar_feed_for"(text);--> statement-breakpoint
DROP TABLE "calendar_feeds";
