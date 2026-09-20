-- Belegpositionen mit Beträgen und Steuer.
--
-- Der Beleg war bisher ein Kopf ohne Inhalt. Die Zeilen kommen hier dazu, und
-- mit ihnen drei Dinge, die drizzle-kit nicht schreibt.
--
-- **Die Beträge stehen an der Zeile, nicht am Kopf.** Eine Summe am Beleg wäre
-- dieselbe Zahl an einem zweiten Ort, und zwei Orte laufen auseinander. Was
-- der Kopf zeigt, rechnet `totalsFor` aus diesen Zeilen, mit dem Belegdatum.
--
-- **`net_cents` wird gespeichert und von einem Check gehalten.** Gespeichert,
-- weil Menge mal Preis gerundet werden muss und die gerundete Zahl die ist,
-- die der Kunde gesehen hat. Gehalten, weil eine gespeicherte Zahl, die
-- niemand prüft, einmal falsch wird und falsch bleibt. Der Check rechnet
-- dieselbe Arithmetik wie `lineNetCents`, und ein Test misst beide
-- gegeneinander.
--
-- Das `::numeric` im Check ist der ganze Unterschied: PostgreSQL rundet ein
-- `numeric` kaufmännisch und ein `double precision` zur geraden Zahl. Nur das
-- erste stimmt mit der Anwendung überein, und zwar bei jedem zweiten halben
-- Cent.
--
-- **Die Zeile friert mit ihrem Beleg ein.** Der Trigger aus 0002 deckt nur den
-- Kopf ab. Ohne den unten könnte eine Position nach dem Festschreiben noch
-- geändert werden, und dann wäre die ganze Nummernvergabe nichts wert.

CREATE TYPE "public"."line_unit" AS ENUM('piece', 'hour', 'day', 'metre', 'square_metre', 'cubic_metre', 'kilogram', 'litre', 'package', 'flat_rate');--> statement-breakpoint
CREATE TYPE "public"."vat_rate" AS ENUM('standard', 'reduced');--> statement-breakpoint
CREATE TYPE "public"."tax_treatment" AS ENUM('standard', 'small_business', 'reverse_charge');--> statement-breakpoint
CREATE TABLE "document_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"designation" text NOT NULL,
	"description" text,
	"quantity_milli" integer NOT NULL,
	"unit" "line_unit" NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"vat_rate" "vat_rate" DEFAULT 'standard' NOT NULL,
	"net_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "document_lines_position_positive" CHECK ("document_lines"."position" >= 1),
	CONSTRAINT "document_lines_net_matches_quantity" CHECK ("document_lines"."net_cents" = sign("document_lines"."quantity_milli"::numeric * "document_lines"."unit_price_cents")
        * round(abs("document_lines"."quantity_milli"::numeric * "document_lines"."unit_price_cents") / 1000))
);
--> statement-breakpoint
ALTER TABLE "document_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tax_treatment" "tax_treatment" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_lines_document_idx" ON "document_lines" USING btree ("tenant_id","document_id","position");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_lines" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("document_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("document_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "document_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_lines" TO "opengewerk_app";--> statement-breakpoint

-- Was die Zeile unveränderlich macht, sobald ihr Beleg es ist.
--
-- Der Name ist kein Geschmack. PostgreSQL feuert BEFORE-Trigger in
-- alphabetischer Reihenfolge, und `document_lines_stay_fixed` läuft damit vor
-- `stamp_sync_columns`: die Prüfung sieht die Zeile so, wie der Aufrufer sie
-- geschickt hat, und nicht mit den Buchhaltungsspalten, die der andere Trigger
-- erst setzt. Dieselbe Überlegung steht in 0004 über `documents_stay_fixed`.
--
-- Beim Löschen wird ein fehlender Beleg durchgelassen, und das ist kein Loch.
-- Die Zeilen hängen mit ON DELETE CASCADE am Beleg: wird ein Entwurf gelöscht,
-- ist die Kopfzeile schon weg, wenn dieser Trigger für die Zeile läuft. Wer
-- hier streng wäre, verböte das Löschen eines Entwurfs. Ein festgeschriebener
-- Beleg kann ohnehin nicht gelöscht werden, dafür sorgt `document_stays_fixed`
-- eine Tabelle höher, es gibt also keinen Weg, auf dem ein fehlender Beleg
-- etwas anderes bedeuten könnte als einen Entwurf, der gerade verschwindet.
CREATE FUNCTION "document_line_stays_fixed"() RETURNS trigger AS $$
DECLARE
	parent_status public.document_status;
BEGIN
	IF tg_op <> 'INSERT' THEN
		SELECT status INTO parent_status FROM public.documents WHERE id = old.document_id;

		IF tg_op = 'DELETE' AND parent_status IS NULL THEN
			RETURN old;
		END IF;

		IF parent_status IS DISTINCT FROM 'draft' THEN
			RAISE EXCEPTION 'Die Positionen eines festgeschriebenen Belegs werden nicht geändert.'
				USING ERRCODE = 'OG001';
		END IF;
	END IF;

	IF tg_op <> 'DELETE' THEN
		-- Auch beim Verschieben auf einen anderen Beleg, deshalb beide Seiten.
		-- Ein fehlender Beleg ist hier ein Fehler und kein Sonderfall: eine
		-- Position ohne Kopf gehört zu nichts.
		SELECT status INTO parent_status FROM public.documents WHERE id = new.document_id;

		IF parent_status IS DISTINCT FROM 'draft' THEN
			RAISE EXCEPTION 'Die Positionen eines festgeschriebenen Belegs werden nicht geändert.'
				USING ERRCODE = 'OG001';
		END IF;
	END IF;

	IF tg_op = 'DELETE' THEN
		RETURN old;
	END IF;

	RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "document_lines_stay_fixed"
	BEFORE INSERT OR UPDATE OR DELETE ON "document_lines"
	FOR EACH ROW EXECUTE FUNCTION "document_line_stays_fixed"();--> statement-breakpoint

-- Die beiden, die jede neue Tabelle wieder braucht: der Audit-Trigger aus 0003
-- und, weil die Tabelle die Abgleichspalten trägt, der Stempel aus 0004.
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "document_lines"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "document_lines"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
