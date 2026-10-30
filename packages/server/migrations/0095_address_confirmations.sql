-- An address holds only once a mail reached it (N28 of the security audit,
-- opengewerk#754).
--
-- **`auth_address_confirmations`**: an address that waits for the link in the
-- mail to it, one per account, with the SHA-256 of the token and the day the
-- link ends. A new address under "Konto" or a correction under "Zugänge" no
-- longer replaces the old one; the link does, and sets `email_verified`.
-- Everything down to the policy comes from the schema; FORCE and the grants
-- are written by hand. A row is replaced and removed, never changed.
--
-- **`auth_users.email_verified`**: the application never set it. Every
-- address there is now counts as confirmed (Moritz, 30.10.2026): the accounts
-- of an instance are known to whoever runs it, and from here on an address
-- that was not confirmed comes only from an invitation handed over as a link.
-- An account found through its address alone, by an invitation to an account
-- that is there, the appointment to run the instance or the command line, is
-- found only through a confirmed one.
--
-- **Fits the version before it**: it reads neither the table nor the flag.
CREATE TABLE "auth_address_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_address_confirmations_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "auth_address_confirmations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_address_confirmations_email_shaped" CHECK ("auth_address_confirmations"."email" = lower(btrim("auth_address_confirmations"."email")) and position('@' in "auth_address_confirmations"."email") > 1 and char_length("auth_address_confirmations"."email") <= 320),
	CONSTRAINT "auth_address_confirmations_token_shaped" CHECK ("auth_address_confirmations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_address_confirmations_expiry" CHECK ("auth_address_confirmations"."expires_at" > "auth_address_confirmations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "auth_address_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_address_confirmations" ADD CONSTRAINT "auth_address_confirmations_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_address_confirmations" ADD CONSTRAINT "auth_address_confirmations_requested_by_auth_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_address_confirmations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
ALTER TABLE "auth_address_confirmations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "auth_address_confirmations" TO "opengewerk_app";--> statement-breakpoint
UPDATE "auth_users" SET "email_verified" = true WHERE "email_verified" IS NOT true;
