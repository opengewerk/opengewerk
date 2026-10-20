-- Who stored a file (found in the security review,
-- opengewerk-haustechnik#360). The row of a file is one for the whole
-- business, and a record that names a file by its hash is how its bytes are
-- handed out; whoever knew the hash of a file they could not see named it in a
-- record of their own and read it there. From now on a record names a file
-- only when the person stored it themselves or a row in their reach names it
-- already (`mayNameFile`), and this table says who stored which file. The
-- table is the foundation's (`file_uploads`); every application adds it with a
-- migration of its own.
--
-- A person reads their own rows and nobody else's, and adds rows for
-- themselves alone. Added and never changed or removed, like the files.
--
-- **Who stored the files of before.** The change log kept the person who
-- inserted each row of `files`, which is the first person who stored its
-- bytes; each of them gets a row, so that a file stored before the update and
-- named after it still lands. Whoever stored the same bytes after them left no
-- trace and stores them again if they need to. Row level security is lifted on
-- `files` for the statement, because as the owner under FORCE it would find no
-- row and say nothing; the change log lets its owner read it as it is.
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_in_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_uploads_once" ON "file_uploads" USING btree ("tenant_id","sha256","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "file_uploads" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("file_uploads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("file_uploads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "held_by_the_person_asking" ON "file_uploads" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("file_uploads"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("file_uploads"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "file_uploads" ("tenant_id", "sha256", "user_id", "created_at", "updated_at")
	SELECT "f"."tenant_id", "f"."sha256", "e"."user_id", min("e"."changed_at"), min("e"."changed_at")
	FROM "audit_entries" AS "e"
	JOIN "files" AS "f"
		ON "f"."tenant_id" = "e"."tenant_id"
		AND "f"."id" = "e"."record_id"
	WHERE "e"."table_name" = 'files'
		AND "e"."operation" = 'insert'
		AND "e"."user_id" IS NOT NULL
	GROUP BY "f"."tenant_id", "f"."sha256", "e"."user_id";--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_uploads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Who stored a file is added and stays.
GRANT SELECT, INSERT ON "file_uploads" TO "opengewerk_app";
