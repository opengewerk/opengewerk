-- The funding programmes as templates of the office, and the capacity and
-- power of a battery and a wallbox (#307, Feature-Gliederung v2.59).
--
-- **The new table** `funding_programs`: what a programme asks for as proof, in
-- its order and its words, the kinds of installation it is for and the text of
-- the declaration of the business. It goes to no device and carries no columns
-- of the sync; no row names a programme, so one is deleted for real, like a
-- text snippet, and the audit log keeps the deletion.
--
-- **`installations`** gains `usable_capacity_wh` and `rated_power_w`: what a
-- battery delivers of its charge, and the power a battery or a wallbox is
-- rated for. Empty for every row there is, which the check lets stand.
--
-- **The rights** "Förderprogramme ansehen" and "Förderprogramme pflegen" go to
-- the owner and the office of every business there is, as their roles in the
-- code have them from now on.
--
-- Everything down to the policy comes from the schema; FORCE, the grant, the
-- trigger and the rights of the roles are written by hand.
--
-- **Fits the version before it**: it reads neither the table nor the two
-- columns, writes an installation without them, which leaves them empty, and
-- a role with a right it does not know asks for nothing.
CREATE TABLE "funding_programs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sponsor" text,
	"url" text,
	"kinds" text[] NOT NULL,
	"evidence" jsonb NOT NULL,
	"declaration" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_programs_texts_fit" CHECK (char_length("funding_programs"."name") between 1 and 200
        and char_length(coalesce("funding_programs"."sponsor", '')) <= 200
        and char_length(coalesce("funding_programs"."url", '')) <= 500
        and char_length(coalesce("funding_programs"."declaration", '')) <= 5000),
	CONSTRAINT "funding_programs_kinds" CHECK (cardinality("funding_programs"."kinds") between 1 and 3
        and "funding_programs"."kinds" <@ array['pv_system', 'battery', 'wallbox']::text[]),
	CONSTRAINT "funding_programs_evidence" CHECK (jsonb_typeof("funding_programs"."evidence") = 'array'
        and jsonb_array_length("funding_programs"."evidence") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "funding_programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "usable_capacity_wh" integer;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "rated_power_w" integer;--> statement-breakpoint
ALTER TABLE "funding_programs" ADD CONSTRAINT "funding_programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_ratings" CHECK (("installations"."usable_capacity_wh" is null or ("installations"."kind"::text in ('battery')
          and "installations"."usable_capacity_wh" between 1 and 100000000))
        and ("installations"."rated_power_w" is null or ("installations"."kind"::text in ('battery', 'wallbox')
          and "installations"."rated_power_w" between 1 and 100000000)));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "funding_programs" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("funding_programs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("funding_programs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "funding_programs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "funding_programs" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "funding_programs"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
-- The new rights "Förderprogramme ansehen" and "Förderprogramme pflegen" for
-- the owner and the office of every business there is.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'funding_program.read')
 WHERE "key" IN ('owner', 'office') AND NOT ('funding_program.read' = ANY ("rights"));--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'funding_program.write')
 WHERE "key" IN ('owner', 'office') AND NOT ('funding_program.write' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
