-- Takes back 0116 (#306). A grid operator is what the office typed in, with
-- the entry of the business in its directory: this rollback deletes none, nor
-- the grid operator an installation names. While there is one, it stops, the
-- way the rollback of 0115 stops at a handover. Which they are, this shows:
--
--   select id, name, registration_number, registered_until from grid_operators;
--   select id, designation, grid_operator_id, grid_operator_reference from installations where grid_operator_id is not null or grid_operator_reference is not null;
--
-- The rights "Netzbetreiber ansehen" and "Netzbetreiber pflegen" stay in the
-- roles that have them, where they ask for nothing any more.
--
-- The owner sees no row of a table under FORCE, so the check looks past the
-- policy, and in one statement with switching it off and on again: if the
-- check stops, nothing of it stays changed.
DO $$
BEGIN
	ALTER TABLE "grid_operators" NO FORCE ROW LEVEL SECURITY;
	ALTER TABLE "installations" NO FORCE ROW LEVEL SECURITY;

	IF EXISTS (SELECT 1 FROM "grid_operators")
		OR EXISTS (
			SELECT 1 FROM "installations"
			WHERE "grid_operator_id" IS NOT NULL OR "grid_operator_reference" IS NOT NULL
		) THEN
		RAISE EXCEPTION 'Es gibt Netzbetreiber oder Anlagen, die einen nennen (#306). Die Rücknahme von 0116 löscht sie nicht und bricht deshalb ab; wer sie trotzdem braucht, sichert die Datenbank und entfernt sie vorher selbst. Welche es sind, zeigen die Abfragen in der Rücknahme von 0116.';
	END IF;

	ALTER TABLE "installations" FORCE ROW LEVEL SECURITY;
END
$$;--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_grid_operator_in_tenant";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_grid_operator_kind";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_grid_operator_reference_fits";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "grid_operator_id";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN "grid_operator_reference";--> statement-breakpoint
DROP TABLE "grid_operators";
