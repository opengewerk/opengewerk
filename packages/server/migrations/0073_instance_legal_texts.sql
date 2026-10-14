-- The legal texts of the instance (opengewerk-haustechnik#129): its legal
-- notice and its notice on data protection, kept by whoever runs the instance
-- in its area and read by anybody, before signing in as well. They are in no
-- source code, and they are the same for every business on the instance.
--
-- **Why columns on the settings of the instance.** There is one legal notice
-- of the instance or none, and the settings of the instance are the one row
-- that belongs to no business. Its trigger writes every change into the log of
-- the instance, with person and way, which is where the screen reads who
-- changed a text last; the trigger itself does not change.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this migration runs on unchanged: it reads and writes the columns it
-- knows, and both new ones may be null.

ALTER TABLE "instance_settings" ADD COLUMN "imprint" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "privacy_notice" text;
