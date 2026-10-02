-- The offline data layer: what keeps a record true while it is changed in two
-- places at once. The three tables come from the schema, and so do the five
-- columns a travelling record carries; in here is what fills them.
--
-- All of it is kept by a trigger rather than by whoever writes the row. A line
-- the application has to remember is a line it forgets at the sixteenth place,
-- and here it would forget it invisibly: a stale version only hurts the next
-- time two devices meet, which is days later and somewhere else.
--
-- 1. `version`, `updated_by`, `device_id`: who changed the row, from where,
--    and how often it has changed at all.
-- 2. `change_sequence`: where the change sits in the tenant's stream. It comes
--    from one counter row per tenant, so the numbers come out in the order the
--    transactions commit. A cursor on timestamps instead would quietly skip a
--    row whose transaction started early and committed late, and the device
--    would never hear about that row again.
-- 3. `deleted_at`: a row is marked, not removed. A removed row is a row a
--    device that was offline never learns about, because a delta pull delivers
--    what changed and a row that is gone is not among it.

-- The counter. SECURITY DEFINER because the application role has no business
-- writing here and does not have the grant for it; the number is handed out,
-- not asked for.
--
-- ON CONFLICT DO UPDATE rather than DO NOTHING, for the same reason as in the
-- audit chain: DO NOTHING would let a second transaction fall through without
-- seeing the row the first one has not committed yet.
CREATE FUNCTION "next_sync_sequence"(tenant uuid) RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	assigned bigint;
BEGIN
	INSERT INTO public.sync_sequences (tenant_id)
	VALUES (tenant)
	ON CONFLICT (tenant_id) DO UPDATE SET next_value = sync_sequences.next_value + 1,
		updated_at = now()
	RETURNING next_value INTO assigned;

	RETURN assigned;
END;
$$;--> statement-breakpoint

-- What keeps the five columns true. It does not touch a table, so it runs as
-- whoever triggered it; the counter it calls is the part that needs more.
--
-- The trigger that calls it goes on every table that carries the columns, and
-- its name matters. PostgreSQL fires BEFORE triggers in alphabetical order, so
-- `stamp_sync_columns` runs after a trigger named for its table, and a check
-- that guards a fixed record sees the row as the caller sent it.
CREATE FUNCTION "stamp_sync_columns"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.updated_at := now();
	new.updated_by := nullif(current_setting('app.user_id', true), '');
	new.device_id := nullif(current_setting('app.device_id', true), '');
	new.version := CASE WHEN tg_op = 'UPDATE' THEN old.version + 1 ELSE 1 END;
	new.change_sequence := public.next_sync_sequence(new.tenant_id);

	RETURN new;
END;
$$;
