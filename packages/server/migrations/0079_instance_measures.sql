-- Part B of the technical and organisational measures and the subprocessors
-- of the instance (opengewerk-haustechnik#358): what whoever runs the instance
-- ensures while running it, and who works for them doing so, annexes 1 and 2
-- of the contract on processing on behalf. Kept in the area of the instance
-- and read into the documents of a tenant; the trades application has no
-- screen for them yet, the foundation brings the columns all the same.
--
-- **Why columns on the settings of the instance.** Like the legal texts
-- (0073): one row that belongs to no business, whose trigger writes every
-- change into the log of the instance with person and way. Both are JSON,
-- an object of the fields of part B and a list of the rows of annex 2, which
-- the server checks before it keeps them; the database holds their shape.
--
-- No row is written by hand: the one row of settings takes the defaults, an
-- empty part B and no subprocessor. A version of the application from before
-- this migration runs on unchanged: it neither reads nor writes the columns.

ALTER TABLE "instance_settings" ADD COLUMN "measures" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "subprocessors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_measures_object" CHECK (jsonb_typeof("instance_settings"."measures") = 'object');--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_subprocessors_list" CHECK (jsonb_typeof("instance_settings"."subprocessors") = 'array');