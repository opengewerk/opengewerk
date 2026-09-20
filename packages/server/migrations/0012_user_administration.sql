-- User administration: how a business puts somebody else to work without a
-- shell on the server, and how it stops them again.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: the grants, the audit trigger, and the one function a
-- redemption needs.
--
-- **Why `blocked_at` sits on the membership.** A business may shut somebody
-- out of itself. It may not shut them out of the company next door on the same
-- instance, and a column on `auth_users` would let it, silently and with no
-- route needed. The roles live here for the same reason. Blocking rather than
-- deleting, because a deleted account takes the name off everything the person
-- ever wrote and leaves the audit log pointing at an identifier nobody can
-- resolve.
--
-- **Why an invitation carries a hash and not a token.** The link is shown once,
-- at the moment it is made, and what stays behind is the SHA-256 of what was in
-- it. A copy of this table is then a list of who was invited rather than a ring
-- of keys. The same reason a password is not stored either, and it costs
-- nothing here: nobody ever needs to read a token back, only to recognise one.
--
-- **Why the redemption needs a function at all.** It arrives without a session,
-- so there is no business set, and `tenant_isolation` on `invitations`
-- therefore matches no row: the caller cannot even find the invitation that was
-- made for them. The token is what names the business, and the token can only
-- be looked up by something that sees the table whole. That is `invitation_for`
-- below, which runs as the owner of the tables for exactly one statement and
-- reads nothing else.
--
-- **Why only the reading half needs it.** Once the function has answered, the
-- application knows the business and walks into it the ordinary way, so
-- creating the account, granting the membership and marking the invitation used
-- all happen under the policies every other write goes through. Marking it used
-- carries `redeemed_at IS NULL` in its where clause and counts the rows it
-- changed: two people opening the same link at the same moment leave one
-- membership between them and not two, without a lock and without a second
-- question.

CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"roles" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_auth_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_open_idx" ON "invitations" USING btree ("tenant_id","redeemed_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("invitations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invitations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "invitations" AS PERMISSIVE FOR SELECT TO current_user USING (true);

ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- No DELETE, like `memberships` and `tenant_sessions` in 0009 and for the same
-- reason: who was invited, by whom and what became of it is part of the record,
-- and a row that can be removed is a record with a hole in it. An invitation
-- that is called back is marked in `revoked_at`, which is a change and lands in
-- the log.
GRANT SELECT, INSERT, UPDATE ON "invitations" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "invitations"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- The one invitation a token names, and the business it belongs to.
--
-- A set rather than a single row, so that an unknown token comes back as no
-- rows instead of a row of nulls a caller has to tell apart from a real one.
--
-- The name of the business comes along, from a join the caller could not make
-- itself: `tenants` is readable outside a business only as far as one's own
-- memberships reach, and whoever is holding an invitation has none yet. Without
-- it the screen could only say that somebody was invited, not to what, and that
-- is the one thing the person opening the link needs to recognise.
--
-- It returns the row as it stands, used, called back and expired ones included,
-- and the application decides what to say about each. Four states need four
-- sentences, and sentences are read by a person, so they belong where the rest
-- of the German is and not in a RAISE here.
--
-- STABLE, and reading is all it does. It cannot be turned into a way of listing
-- invitations or businesses: the only way in is a token whose hash matches, and
-- the hash of 32 random bytes is not something to guess at.
CREATE FUNCTION "invitation_for"(hash text)
	RETURNS TABLE (
		invitation_id uuid,
		business uuid,
		company text,
		invited_email text,
		invited_name text,
		invited_roles text[],
		expires timestamp with time zone,
		redeemed timestamp with time zone,
		revoked timestamp with time zone
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT i.id, i.tenant_id, t.name, i.email, i.name, i.roles,
	       i.expires_at, i.redeemed_at, i.revoked_at
	  FROM public.invitations i
	  JOIN public.tenants t ON t.id = i.tenant_id
	 WHERE i.token_hash = hash
$$;--> statement-breakpoint

-- EXECUTE belongs to everybody by default, which here would mean every role in
-- the cluster. Taken away and given back to the one role that calls it, so that
-- a role added later for something else does not inherit a way past the
-- isolation.
REVOKE EXECUTE ON FUNCTION "invitation_for"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "invitation_for"(text) TO "opengewerk_app";
