-- The calendar of a person (#291, Feature-Gliederung v2.48).
--
-- **The new table** holds the address a person's own calendar subscribes to,
-- as the SHA-256 of its token: shown once when it is made, never stored. A new
-- address ends the one before, ending sets `ended_at`, and nothing is removed.
-- It does not travel to the devices, and the application may change no more
-- than the end of one.
--
-- **The function** `calendar_feed_for` is how a calendar finds its business:
-- it asks without a session, like the link of an invitation, and only the
-- token names the tenant. It runs as the owner, which reads the table through
-- `readable_by_the_owner`, as `invitation_for` reads the invitations.
--
-- Everything down to the policies comes from the schema; FORCE, the grants,
-- the trigger and the function are written by hand.
--
-- **Fits the version before it**: it reads nothing new.
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_token_shaped" CHECK ("calendar_feeds"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "calendar_feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_work_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_token" ON "calendar_feeds" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_one_open" ON "calendar_feeds" USING btree ("tenant_id","user_id") WHERE "calendar_feeds"."ended_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "calendar_feeds" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("calendar_feeds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("calendar_feeds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "calendar_feeds" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
ALTER TABLE "calendar_feeds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "calendar_feeds" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("ended_at", "updated_at") ON "calendar_feeds" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "calendar_feeds"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- Runs as the owner, past the policies, because a calendar asks without a
-- session and so in no tenant. It answers one question: which business and
-- person a hash belongs to, whether the address was ended, and the name of the
-- business for the name of the calendar. Nothing else of any business: the way
-- in is a hash of 32 random bytes, which is not something to guess at.
CREATE FUNCTION "calendar_feed_for"(hash text)
	RETURNS TABLE (
		feed uuid,
		business uuid,
		company text,
		person text,
		ended timestamp with time zone
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT f.id, f.tenant_id, t.name, f.user_id, f.ended_at
	  FROM public.calendar_feeds f
	  JOIN public.tenants t ON t.id = f.tenant_id
	 WHERE f.token_hash = hash
$$;--> statement-breakpoint

-- EXECUTE belongs to everybody by default; taken away and given to the one
-- role that calls it, as for `invitation_for` in 0012.
REVOKE EXECUTE ON FUNCTION "calendar_feed_for"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "calendar_feed_for"(text) TO "opengewerk_app";
