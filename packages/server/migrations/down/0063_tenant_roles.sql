-- Rolling the roles of a business back to how 0062 left the schema
-- (ADR 0010, opengewerk-haustechnik#8).
--
-- What it costs an installation that runs it: the rows. The version before
-- this migration decides by the three roles in its code, and the rows this
-- migration wrote said the same, so everybody may afterwards do what they
-- could before. Nothing but those three roles can be in the table at this
-- point: no route writes a role of a business's own yet.
--
-- Run as the superuser, like every rollback. The audit log keeps its entries
-- about the table, the same choice as in every earlier rollback.

DROP TABLE "tenant_roles";
