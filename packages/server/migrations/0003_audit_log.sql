-- Audit-Log auf Feldebene. Der obere Teil kommt aus dem Schema, alles ab
-- FORCE steht von Hand, weil drizzle-kit davon nichts kennt: die Rechte, den
-- Trigger, der schreibt, und den Trigger, der das Geschriebene festhaelt.
--
-- Drei Entscheidungen stecken darin.
--
-- 1. Ein Trigger, keine Zeile im Server. Das Issue verlangt, dass eine
--    Aenderung ueber jeden Weg im Log auftaucht, auch ueber eine Migration
--    oder eine psql-Sitzung. Alles, was die Anwendung selbst schreiben
--    muesste, faengt genau an der Stelle nichts, an der sie umgangen wird.
-- 2. Der Trigger haengt an jeder Tabelle, und zwar ueber eine Schleife ueber
--    den Katalog statt ueber eine Liste. Eine Liste waere schon beim
--    Schreiben unvollstaendig. Fuer die naechste Migration hilft das nicht
--    mehr, deshalb prueft ein Test dieselbe Frage am Katalog nach: eine neue
--    Tabelle ohne Trigger macht ihn rot.
-- 3. Die Anwendungsrolle bekommt auf dieser Tabelle nur SELECT. Sie kann also
--    weder einen Eintrag faelschen noch einen loeschen; geschrieben wird
--    ausschliesslich durch den Trigger, der als sein Eigentuemer laeuft.
--
-- Ergaenzt wird das Log, mehr nicht. Was auch das nicht leistet: gegen einen
-- Superuser schuetzt in einer Datenbank nichts, der kann den Trigger
-- abschalten. Wer darueber hinaus will, braucht eine Hashkette oder einen
-- Speicher, der nicht ueberschreibbar ist; beides gehoert nicht in dieses
-- Issue.

CREATE TYPE "public"."audit_operation" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"operation" "audit_operation" NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"reason" text,
	"database_role" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_record_idx" ON "audit_entries" USING btree ("tenant_id","table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_entries_time_idx" ON "audit_entries" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_entries" AS PERMISSIVE FOR SELECT TO "opengewerk_app" USING ("audit_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "audit_entries" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);

ALTER TABLE "audit_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "audit_entries" TO "opengewerk_app";--> statement-breakpoint

-- Der Schreiber. SECURITY DEFINER, damit er auch dann in das Log kommt, wenn
-- die ausloesende Rolle dort nichts darf; das ist genau der Fall, den man
-- haben will, denn sonst waere das Log nur so vollstaendig wie die Rechte
-- dessen, der es umgehen moechte. search_path steht fest und beginnt mit
-- pg_catalog, damit niemand eine eingebaute Funktion unterschieben kann.
--
-- Eine Zeile je Feld, das sich wirklich unterscheidet. Verglichen wird ueber
-- die Textform aus to_jsonb, nicht ueber eine Spaltenliste: eine spaeter
-- hinzugefuegte Spalte ist damit automatisch dabei. Ausgenommen ist einzig
-- updated_at, dessen ganze Aussage "hier hat sich etwas geaendert" im Log
-- ohnehin genauer steht.
CREATE FUNCTION "record_change"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	before_row jsonb := '{}'::jsonb;
	after_row jsonb := '{}'::jsonb;
	present jsonb;
	change uuid := uuidv7();
	tenant uuid;
	record_key uuid;
BEGIN
	IF tg_op <> 'INSERT' THEN
		before_row := to_jsonb(old);
	END IF;

	IF tg_op <> 'DELETE' THEN
		after_row := to_jsonb(new);
	END IF;

	present := CASE WHEN tg_op = 'DELETE' THEN before_row ELSE after_row END;

	-- Der Mandant steht in jeder Tabelle in tenant_id. Die eine Ausnahme ist
	-- tenants selbst, wo die eigene id der Mandant ist. Eine kuenftige Tabelle
	-- ohne beides laesst den Einfuegevorgang an NOT NULL scheitern, und das
	-- ist die richtige Richtung: lieber laut beim Migrieren als still im Log.
	tenant := coalesce(present ->> 'tenant_id', present ->> 'id')::uuid;
	record_key := (present ->> 'id')::uuid;

	INSERT INTO public.audit_entries (
		tenant_id, change_id, table_name, record_id, operation,
		field, old_value, new_value, user_id, reason, database_role
	)
	SELECT
		tenant,
		change,
		tg_table_name,
		record_key,
		lower(tg_op)::public.audit_operation,
		changed.field,
		before_row ->> changed.field,
		after_row ->> changed.field,
		nullif(current_setting('app.user_id', true), ''),
		nullif(current_setting('app.reason', true), ''),
		session_user
	FROM jsonb_object_keys(before_row || after_row) AS changed(field)
	WHERE changed.field <> 'updated_at'
		AND (before_row ->> changed.field) IS DISTINCT FROM (after_row ->> changed.field);

	RETURN NULL;
END;
$$;--> statement-breakpoint

-- An jede Tabelle ausser das Log selbst, das sich sonst endlos protokollieren
-- wuerde. Die Tabelle des Migrationswerkzeugs bleibt ebenfalls aussen vor: sie
-- hat keine Spalte id und gehoert keinem Mandanten.
DO $$
DECLARE
	target text;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_class c
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public'
		   AND c.relkind = 'r'
		   AND c.relname NOT IN ('audit_entries', '__drizzle_migrations')
		 ORDER BY c.relname
	LOOP
		EXECUTE format(
			'CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON %I
			 FOR EACH ROW EXECUTE FUNCTION "record_change"()',
			target
		);
	END LOOP;
END
$$;--> statement-breakpoint

-- Und der Riegel davor. Ein Eintrag wird geschrieben und danach nicht mehr
-- angefasst. TRUNCATE braucht einen eigenen Trigger, weil es die Zeilen gar
-- nicht einzeln anfasst und ein Zeilentrigger deshalb nie ausloest.
CREATE FUNCTION "audit_entry_stays"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Das Audit-Log wird nur ergänzt. Ein Eintrag wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG002';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "audit_entries_stay"
	BEFORE UPDATE OR DELETE ON "audit_entries"
	FOR EACH ROW EXECUTE FUNCTION "audit_entry_stays"();--> statement-breakpoint

CREATE TRIGGER "audit_entries_stay_on_truncate"
	BEFORE TRUNCATE ON "audit_entries"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_entry_stays"();
