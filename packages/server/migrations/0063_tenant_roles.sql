-- The roles of a business as rows (ADR 0010, opengewerk-haustechnik#8).
--
-- Until now the three roles and what each may do stood in the code, and a
-- membership named them by key. From here on a business has its roles as
-- rows: the key a membership names, the name a screen calls it by, the rights
-- it gives, and two flags that are not rights, whether the role leads the
-- business and whether it works only with a second factor. What somebody may
-- do is read from these rows on every request.
--
-- Everything down to the policy comes from the schema. What follows it is
-- written by hand: the audit trigger, the three roles for every business
-- that is already there, and then FORCE and the grants.
--
-- **The order is the point.** The trigger comes before the rows, so that the
-- beginning of the roles of a business stands in its log, with `migration` as
-- the reason. FORCE comes after them: migrations run as the owner of the
-- tables, no policy on this table names the owner, and under FORCE the owner
-- could not write a row (see the addenda to ADR 0003). The businesses are
-- found through `readable_by_the_owner` on `tenants`.
--
-- **The rights are those of the code at this moment**, role by role, so that
-- every person may do after this migration exactly what they could before
-- it. A test holds the rows of a business from before this migration against
-- the roles the code ships. From here on a right added to one of the three
-- roles is a migration that adds it to these rows; the list in the code is
-- what a new business is given.
--
-- **Fits the version before it.** That version never asks this table, and
-- nothing it does ask changes. It decides by the list in its code until it is
-- replaced, and the list and the rows say the same. A business it creates in
-- the moment between this migration and its replacement has no rows here; the
-- next version gives it the three when it starts (`completeRoles`).
--
-- The application may read the table and insert into it: it writes the roles
-- of a business it brings into being. Nothing changes or removes a role yet,
-- so nothing may.

CREATE TABLE "tenant_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"rights" text[] NOT NULL,
	"leads" boolean DEFAULT false NOT NULL,
	"second_factor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_roles_key_once" UNIQUE("tenant_id","key"),
	CONSTRAINT "tenant_roles_key_plain" CHECK ("tenant_roles"."key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "tenant_roles_label_shaped" CHECK ("tenant_roles"."label" = btrim("tenant_roles"."label") and char_length("tenant_roles"."label") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "tenant_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_roles" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tenant_roles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_roles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tenant_roles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
INSERT INTO "tenant_roles" ("tenant_id", "key", "label", "leads", "second_factor", "rights")
SELECT "tenants"."id", "shipped"."key", "shipped"."label", "shipped"."leads",
       "shipped"."second_factor", "shipped"."rights"
  FROM "tenants"
 CROSS JOIN (
	VALUES
		(1, 'owner', 'Inhaber', true, true, ARRAY[
			'customer.read', 'customer.create', 'customer.write', 'site.read',
			'site.write', 'site.access', 'installation.read', 'installation.write',
			'article.read', 'article.write', 'supplier.read', 'supplier.write',
			'purchase.read', 'purchase.write', 'job.read', 'job.write',
			'job.progress', 'job.read.all', 'document.read', 'document.write',
			'document.issue', 'payment.read', 'payment.write', 'task.read',
			'task.write', 'deadline.read', 'deadline.write', 'attachment.read',
			'attachment.write', 'time.read', 'time.write', 'sync.read',
			'sync.write', 'settings.read', 'settings.write', 'membership.read',
			'membership.write', 'mail.read', 'mail.write', 'audit.read',
			'tenant.create', 'push.write'
		]::text[]),
		(2, 'office', 'Büro', false, false, ARRAY[
			'customer.read', 'customer.create', 'customer.write', 'site.read',
			'site.write', 'site.access', 'installation.read', 'installation.write',
			'article.read', 'article.write', 'supplier.read', 'supplier.write',
			'purchase.read', 'purchase.write', 'job.read', 'job.write',
			'job.progress', 'job.read.all', 'document.read', 'document.write',
			'document.issue', 'payment.read', 'payment.write', 'task.read',
			'task.write', 'deadline.read', 'deadline.write', 'attachment.read',
			'attachment.write', 'time.read', 'time.write', 'sync.read',
			'sync.write', 'settings.read', 'push.write'
		]::text[]),
		(3, 'technician', 'Monteur', false, false, ARRAY[
			'customer.read', 'customer.create', 'site.read', 'installation.read',
			'installation.write', 'article.read', 'supplier.read', 'job.read',
			'job.progress', 'document.read', 'document.write', 'task.read',
			'task.write', 'attachment.read', 'attachment.write', 'time.write',
			'sync.read', 'sync.write', 'push.write'
		]::text[])
 ) AS "shipped" ("position", "key", "label", "leads", "second_factor", "rights")
 ORDER BY "tenants"."id", "shipped"."position";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "tenant_roles" TO "opengewerk_app";
