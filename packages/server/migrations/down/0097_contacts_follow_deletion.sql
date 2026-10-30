-- Rolling the contacts that follow their customer or site back (#555).
--
-- The trigger goes. The contacts 0097 marked stay marked: which of them it
-- marked is not kept anywhere, and the version before it reads a marked
-- contact the same way, as one that is gone. Every device has already let
-- them go.
DROP TRIGGER "contacts_follow_deletion" ON "sites";--> statement-breakpoint
DROP TRIGGER "contacts_follow_deletion" ON "customers";--> statement-breakpoint
DROP FUNCTION "contacts_follow_deletion"();
