-- The grid operators and the entry of the business in their installer
-- directories (#306, Feature-Gliederung v2.58).
--
-- **The new table** `grid_operators`: who the business reports an
-- installation to, what the operator asks for, its portal and a person to ask,
-- and the entry of the business in its installer directory with its number,
-- its last day and the responsible electrician. It goes to no device and so
-- carries no columns of the sync; a row is removed by marking it, and the
-- application may add and change one, never delete it.
--
-- **`installations`** gains `grid_operator_id` and `grid_operator_reference`:
-- the grid operator a PV system, a battery or a wallbox is reported to, and
-- the number it is known by there. Empty for every row there is. The key on
-- an installation is added with row level security lifted on both tables: an
-- instance migrates as the owner, and under FORCE PostgreSQL checks a key only
-- against the rows the policies show it (0051).
--
-- **The rights** "Netzbetreiber ansehen" and "Netzbetreiber pflegen" go to the
-- owner and the office of every business there is, as their roles in the code
-- have them from now on.
--
-- Everything down to the policy comes from the schema; FORCE, the grant, the
-- trigger, the lifted security around the key and the rights of the roles are
-- written by hand.
--
-- **Fits the version before it**: it reads neither the table nor the two
-- columns, writes an installation without them, which leaves them empty, and
-- a role with a right it does not know asks for nothing.
CREATE TABLE "grid_operators" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"portal_url" text,
	"requirements" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"registration_number" text,
	"registered_until" date,
	"responsible_electrician" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "grid_operators_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "grid_operators_texts_fit" CHECK (char_length("grid_operators"."name") between 1 and 200
        and char_length(coalesce("grid_operators"."portal_url", '')) <= 500
        and char_length(coalesce("grid_operators"."requirements", '')) <= 2000
        and char_length(coalesce("grid_operators"."contact_name", '')) <= 200
        and char_length(coalesce("grid_operators"."contact_email", '')) <= 200
        and char_length(coalesce("grid_operators"."contact_phone", '')) <= 200
        and char_length(coalesce("grid_operators"."registration_number", '')) <= 64
        and char_length(coalesce("grid_operators"."responsible_electrician", '')) <= 200)
);
--> statement-breakpoint
ALTER TABLE "grid_operators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "grid_operator_id" uuid;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "grid_operator_reference" text;--> statement-breakpoint
ALTER TABLE "grid_operators" ADD CONSTRAINT "grid_operators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_grid_operator_in_tenant" FOREIGN KEY ("tenant_id","grid_operator_id") REFERENCES "public"."grid_operators"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_grid_operator_kind" CHECK ("installations"."grid_operator_id" is null or "installations"."kind"::text in ('pv_system', 'battery', 'wallbox'));--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_grid_operator_reference_fits" CHECK (char_length(coalesce("installations"."grid_operator_reference", '')) <= 100);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "grid_operators" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("grid_operators"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("grid_operators"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "grid_operators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "grid_operators" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "grid_operators"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
-- The new rights "Netzbetreiber ansehen" and "Netzbetreiber pflegen" for the
-- owner and the office of every business there is.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'grid_operator.read')
 WHERE "key" IN ('owner', 'office') AND NOT ('grid_operator.read' = ANY ("rights"));--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_append("rights", 'grid_operator.write')
 WHERE "key" IN ('owner', 'office') AND NOT ('grid_operator.write' = ANY ("rights"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
