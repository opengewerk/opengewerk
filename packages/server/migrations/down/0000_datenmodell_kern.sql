-- Die Ruecknahme zu 0000_datenmodell_kern.sql. drizzle-kit erzeugt so eine
-- Datei nicht, ADR 0003 verlangt sie trotzdem: eine Migration, die sich nicht
-- zuruecknehmen laesst, ist beim ersten Fehlschlag im Betrieb ein Restore aus
-- dem Backup statt eines Rueckbaus.
--
-- Die Reihenfolge ist die umgekehrte Abhaengigkeitskette, kein CASCADE. Ein
-- CASCADE wuerde auch wegraeumen, was jemand spaeter danebengebaut hat, und
-- genau das soll hier auffallen statt lautlos zu verschwinden.

DROP TABLE IF EXISTS "documents";--> statement-breakpoint
DROP TABLE IF EXISTS "jobs";--> statement-breakpoint

DROP TABLE IF EXISTS "pv_modules";--> statement-breakpoint
DROP TABLE IF EXISTS "pv_strings";--> statement-breakpoint
DROP TABLE IF EXISTS "inverters";--> statement-breakpoint

DROP TABLE IF EXISTS "equipment";--> statement-breakpoint
DROP TABLE IF EXISTS "circuits";--> statement-breakpoint
DROP TABLE IF EXISTS "board_sections";--> statement-breakpoint
DROP TABLE IF EXISTS "distribution_boards";--> statement-breakpoint

DROP TABLE IF EXISTS "installations";--> statement-breakpoint
DROP TABLE IF EXISTS "contacts";--> statement-breakpoint
DROP TABLE IF EXISTS "sites";--> statement-breakpoint
DROP TABLE IF EXISTS "customers";--> statement-breakpoint
DROP TABLE IF EXISTS "tenants";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."document_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."document_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."job_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."job_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."distribution_board_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."customer_kind";--> statement-breakpoint

DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations";--> statement-breakpoint
DROP SCHEMA IF EXISTS "drizzle";
