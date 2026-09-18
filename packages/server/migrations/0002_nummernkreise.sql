-- Nummernkreise und Festschreibung. Der obere Teil kommt aus dem Schema, der
-- untere steht von Hand: FORCE und GRANT, weil drizzle-kit beides nicht kennt
-- und jede neue Tabelle sie wieder braucht, und der Trigger, weil die
-- Unveränderlichkeit eines festgeschriebenen Belegs in der Datenbank sitzen
-- muss und nicht in der Anwendung. Eine Regel, die nur der Server kennt, gilt
-- nicht mehr, sobald jemand mit psql danebensteht.

CREATE TYPE "public"."number_range_key" AS ENUM('quote', 'order_confirmation', 'delivery_note', 'report', 'invoice');--> statement-breakpoint
CREATE TABLE "number_ranges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" "number_range_key" NOT NULL,
	"pattern" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_ranges_tenant_key" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "number_ranges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "number_ranges" ADD CONSTRAINT "number_ranges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_unique" ON "documents" USING btree ("tenant_id","number") WHERE "documents"."number" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "number_ranges" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("number_ranges"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("number_ranges"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "number_ranges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "number_ranges" TO "opengewerk_app";--> statement-breakpoint

-- Ab der Festschreibung ist ein Beleg fest. Erlaubt bleibt genau ein Schritt,
-- der Wechsel nach storniert, und auch der nur, wenn sonst kein Feld anders
-- ist. Der Vergleich läuft über to_jsonb statt über eine Liste von Spalten:
-- eine Spalte, die später dazukommt, ist damit automatisch mitgeschützt.
--
-- Löschen gibt es nicht. Ein Beleg wird storniert, nie entfernt; das ist
-- Leitentscheidung 4 und der Kern dessen, was die GoBD verlangt.
CREATE FUNCTION "document_stays_fixed"() RETURNS trigger AS $$
BEGIN
	IF tg_op = 'DELETE' THEN
		IF old.status <> 'draft' THEN
			RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht gelöscht, sondern storniert.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN old;
	END IF;

	IF old.status = 'draft' THEN
		RETURN new;
	END IF;

	IF old.status = 'issued' AND new.status = 'cancelled' THEN
		IF to_jsonb(new) - 'status' - 'updated_at'
			IS DISTINCT FROM to_jsonb(old) - 'status' - 'updated_at' THEN
			RAISE EXCEPTION 'Beim Stornieren darf sich außer dem Status nichts ändern.'
				USING ERRCODE = 'OG001';
		END IF;

		RETURN new;
	END IF;

	RAISE EXCEPTION 'Ein festgeschriebener Beleg wird nicht geändert, sondern storniert und neu ausgestellt.'
		USING ERRCODE = 'OG001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "documents_stay_fixed"
	BEFORE UPDATE OR DELETE ON "documents"
	FOR EACH ROW EXECUTE FUNCTION "document_stays_fixed"();
