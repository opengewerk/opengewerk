-- Roles a tenant keeps of its own (opengewerk/opengewerk-haustechnik#346).
--
-- Up to here the application could read `tenant_roles` and insert into it,
-- and nothing else: a tenant had the roles it started with. From here it may
-- change of a row its label, its rights, whether it asks for a second factor
-- and what it was offered, and remove a row. Its key, which a membership
-- names, and whether it leads stay as the row was written: a membership keeps
-- naming the same role, and no row comes to lead a tenant later. Which rows a
-- tenant changes and which rights a role of its own holds, an application
-- decides on its routes; this business software ships none yet.
--
-- `offered_rights` is what the catalogue offered when a role of the tenant's
-- own was last saved, so that a right a later version brings can be told
-- apart from one the tenant left out. Every row gets the empty list, which is
-- what a shipped role keeps.
--
-- A trigger keeps a role that leads whole and a role that a membership or an
-- open invitation names in place, for the application role
-- (`tenant_role_stays_whole`, the block `setup.sql` of the foundation).
--
-- No row is touched beyond the new column. A version of the application from
-- before this one reads the rows as before and leaves the column alone.

ALTER TABLE "tenant_roles" ADD COLUMN "offered_rights" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "tenant_roles" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("label", "rights", "second_factor", "offered_rights", "updated_at") ON "tenant_roles" TO "opengewerk_app";--> statement-breakpoint

-- What keeps a tenant led and no membership naming a role that is gone
-- (opengewerk/opengewerk-haustechnik#346). A tenant changes and removes its
-- roles, and the routes of an application decide which; whatever they decide,
-- a role that leads keeps every right it has and a second factor it asks for
-- and is never removed, and no role goes while a membership or an invitation
-- that is still open names it. It holds the application role to it, and not
-- the owner of the tables: a migration gives a shipped role a right it is
-- owed, as the owner, and one that takes a role back is its own decision.
CREATE FUNCTION "tenant_role_stays_whole"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF current_user <> 'opengewerk_app' THEN
		RETURN coalesce(new, old);
	END IF;

	IF tg_op = 'DELETE' THEN
		IF old.leads THEN
			RAISE EXCEPTION 'Eine Rolle, die einen Mandanten führt, wird nicht entfernt.'
				USING ERRCODE = 'OG004';
		END IF;

		IF EXISTS (SELECT 1 FROM public.memberships m
		            WHERE m.tenant_id = old.tenant_id AND old.key = ANY (m.roles))
		   OR EXISTS (SELECT 1 FROM public.invitations i
		               WHERE i.tenant_id = old.tenant_id AND old.key = ANY (i.roles)
		                 AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN
			RAISE EXCEPTION 'Eine Rolle, die noch einem Zugang oder einer offenen Einladung zugeordnet ist, wird nicht entfernt.'
				USING ERRCODE = 'OG005';
		END IF;

		RETURN old;
	END IF;

	IF old.leads AND (NOT (new.rights @> old.rights) OR (old.second_factor AND NOT new.second_factor)) THEN
		RAISE EXCEPTION 'Eine Rolle, die einen Mandanten führt, behält jedes Recht und den zweiten Faktor.'
			USING ERRCODE = 'OG004';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tenant_roles_stay_whole" BEFORE UPDATE OR DELETE ON "tenant_roles"
	FOR EACH ROW EXECUTE FUNCTION "tenant_role_stays_whole"();
