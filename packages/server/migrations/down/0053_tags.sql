-- Rolling the tags back to how 0052 left the schema (#314).
--
-- What it costs an installation that runs it: every tag and which customer
-- and site had which. The customers and sites themselves stay. Every device
-- drops the three kinds of record at its next exchange.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the tables, the same choice as in every earlier rollback.

DROP TABLE "site_tags";--> statement-breakpoint
DROP TABLE "customer_tags";--> statement-breakpoint
DROP TABLE "tags";
