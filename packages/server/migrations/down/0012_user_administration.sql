-- Rolling user administration back.
--
-- What it costs an installation that runs it: every open invitation stops
-- being redeemable, because the table it lived in is gone, and everybody who
-- was blocked can sign in again. The second one is the dangerous half, so it
-- is worth saying plainly rather than leaving it to be discovered. Somebody
-- who rolls this back has to shut those people out by another means, and the
-- honest one is to take their membership's roles away.
--
-- What it does not cost: the memberships themselves, which stay exactly as
-- they are apart from the column. A person who was put into the business
-- through an invitation is a member like any other afterwards, and nothing
-- about them points back at the link they came in through.
--
-- The audit log keeps its entries about `invitations`, a table that will no
-- longer exist. That is the same choice 0009 made and for the same reason:
-- deleting them would turn a sound chain into one that reports a break, and
-- the honest record of what happened includes a table that was there and is
-- not any more.

DROP FUNCTION IF EXISTS "invitation_for"(text);--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "invitations";--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "invitations";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "invitations";--> statement-breakpoint
DROP TABLE IF EXISTS "invitations";--> statement-breakpoint

ALTER TABLE "memberships" DROP COLUMN IF EXISTS "blocked_at";
