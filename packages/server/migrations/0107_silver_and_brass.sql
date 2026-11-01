-- Silver and brass (#782), which the Z records of DATANORM bring beside copper
-- and aluminium, decided by Moritz on 31.10.2026: read from the Z records
-- with base and weight, and a surcharge only where the office has entered a
-- metal price for them.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing here does.
--
-- **Fits the version before it**: it holds no row with either value until
-- the new version writes one.
ALTER TYPE "public"."metal" ADD VALUE 'silver';--> statement-breakpoint
ALTER TYPE "public"."metal" ADD VALUE 'brass';
