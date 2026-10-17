-- The last day of a membership and of the invitation it comes from
-- (opengewerk-haustechnik#339 and #356): the day in Germany a person works in a
-- business up to, itself included. After it the membership counts as blocked
-- without anybody doing anything; null, which every row is, is a membership
-- without an end.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this one reads the rows as before and leaves the columns alone.

ALTER TABLE "invitations" ADD COLUMN "last_day" date;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "last_day" date;