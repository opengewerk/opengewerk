-- Whoever runs the instance sees only the invitations to lead a business that
-- somebody who runs the instance sent (opengewerk/opengewerk#701, for
-- opengewerk-haustechnik#474, found in the security review #360).
--
-- `tenants_with_leads()` named the address of every open invitation with a
-- role that leads, also those the lead of a business sends to somebody else.
-- That came about in the business, and the area of the instance reads nothing
-- of what does. The screen only ever needed the invitation of the first lead,
-- which whoever creates the business sends from the area of the instance.
--
-- The function runs as the owner of the tables and now asks `instance_operators`
-- who sent an invitation; that table is under FORCE, so it gets the policy
-- `readable_by_the_owner` as `tenant_roles` and `memberships` have it (from the
-- schema). The function is replaced in place, same signature, same grants (the
-- block of the foundation in `sql/instance.sql`).
--
-- Nothing is written and no row is touched. A version of the application from
-- before this one reads the list as before, only shorter.
CREATE POLICY "readable_by_the_owner" ON "instance_operators" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
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
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (i.roles))
	                    AND EXISTS (SELECT 1 FROM public.instance_operators o
	                                 WHERE o.user_id = i.invited_by)), '{}')
	  FROM public.tenants t
	 ORDER BY t.created_at, t.name
$$;
