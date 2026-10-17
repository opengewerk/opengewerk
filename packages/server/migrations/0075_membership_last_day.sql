-- The last day of a membership and of the invitation it comes from
-- (opengewerk-haustechnik#339 and #356): the day in Germany a person works in a
-- business up to, itself included. After it the membership counts as blocked
-- without anybody doing anything; null, which every row is, is a membership
-- without an end.
--
-- Whoever runs the instance no longer counts somebody past their last day
-- among those who lead a business (`tenants_with_leads`, the block of the
-- foundation in `sql/instance.sql`): replaced in place, same signature, same
-- grants.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this one reads the rows as before and leaves the columns alone.

ALTER TABLE "invitations" ADD COLUMN "last_day" date;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "last_day" date;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tenants_with_leads"()
	RETURNS TABLE (id uuid, name text, created_at timestamptz, leads text[], members bigint, invited_leads text[])
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT t.id, t.name, t.created_at,
	       coalesce((SELECT array_agg(m.user_id ORDER BY m.created_at) FROM public.memberships m
	                  WHERE m.tenant_id = t.id AND m.blocked_at IS NULL
	                    AND (m.last_day IS NULL OR m.last_day >= (now() AT TIME ZONE 'Europe/Berlin')::date)
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (m.roles))), '{}'),
	       (SELECT count(*) FROM public.memberships m WHERE m.tenant_id = t.id),
	       coalesce((SELECT array_agg(i.email ORDER BY i.created_at) FROM public.invitations i
	                  WHERE i.tenant_id = t.id
	                    AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (i.roles))), '{}')
	  FROM public.tenants t
	 ORDER BY t.created_at, t.name
$$;
