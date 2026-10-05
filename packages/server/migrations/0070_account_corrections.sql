-- Whoever administers a business corrects the name and the address of an
-- account that works there, and the correction stands in the log of the
-- business (opengewerk-haustechnik#84).
--
-- Everything down to the policy comes from the schema. What follows it is
-- written by hand: FORCE, the grant and the audit trigger of the new table.
--
-- **Why a table in every business.** The name and the address belong to the
-- account and so to the instance, and `auth_users` has no tenant and no audit
-- trigger. A correction made from inside a business is the doing of that
-- business all the same. `account_corrections` holds one row per correction,
-- with what was changed into what, and the audit trigger puts it into the log,
-- as it does with `member_passkeys` for a passkey.
--
-- **Why the grant stops at INSERT.** A row says what happened at one moment.
-- Nothing about it changes afterwards and nothing removes it; the cascade from
-- `memberships` is the one way a row goes, and memberships are blocked rather
-- than deleted.
--
-- **Why each pair may be null.** A correction of the name alone says nothing
-- about the address, and the other way round. The three checks hold a row to
-- that: each half comes as a pair or not at all, and one of them is there.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this migration runs on unchanged, it knows no such route.

CREATE TABLE "account_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name_before" text,
	"name_after" text,
	"email_before" text,
	"email_after" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_corrections_name_in_a_pair" CHECK (("account_corrections"."name_before" is null) = ("account_corrections"."name_after" is null)),
	CONSTRAINT "account_corrections_email_in_a_pair" CHECK (("account_corrections"."email_before" is null) = ("account_corrections"."email_after" is null)),
	CONSTRAINT "account_corrections_names_a_change" CHECK ("account_corrections"."name_after" is not null or "account_corrections"."email_after" is not null)
);
--> statement-breakpoint
ALTER TABLE "account_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_corrections" ADD CONSTRAINT "account_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_corrections" ADD CONSTRAINT "account_corrections_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account_corrections" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("account_corrections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("account_corrections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "account_corrections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "account_corrections" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "account_corrections"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
