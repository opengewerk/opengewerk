-- Takes the key the instance signs PDFs with out again, back to how 0087 left
-- things.
--
-- The columns go without asking, the sealed key and the certificates with
-- them. A PDF signed before stays signed; nothing knows it as one of this
-- instance any more. What the log of the instance said about them it keeps.
--
-- Run as the superuser, like every rollback.
CREATE OR REPLACE FUNCTION "record_instance_change"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	before_row jsonb := '{}'::jsonb;
	after_row jsonb := '{}'::jsonb;
	present jsonb;
	change uuid := uuidv7();
	changed text;
BEGIN
	IF tg_op <> 'INSERT' THEN
		before_row := to_jsonb(old);
	END IF;

	IF tg_op <> 'DELETE' THEN
		after_row := to_jsonb(new);
	END IF;

	present := CASE WHEN tg_op = 'DELETE' THEN before_row ELSE after_row END;

	FOR changed IN
		SELECT k.field
		  FROM jsonb_object_keys(before_row || after_row) AS k(field)
		 WHERE NOT (k.field = ANY (ARRAY['updated_at', 'updated_by', 'version', 'change_sequence', 'mail_server_password']))
		   AND (before_row ->> k.field) IS DISTINCT FROM (after_row ->> k.field)
		 ORDER BY k.field
	LOOP
		INSERT INTO public.instance_changes (change_id, table_name, record_id, operation, field,
			old_value, new_value, user_id, reason, database_role)
		VALUES (change, tg_table_name, present ->> 'id', lower(tg_op)::public.audit_operation, changed,
			before_row ->> changed, after_row ->> changed,
			nullif(current_setting('app.user_id', true), ''),
			nullif(current_setting('app.reason', true), ''),
			session_user);
	END LOOP;

	RETURN NULL;
END;
$$;--> statement-breakpoint

ALTER TABLE "instance_settings" DROP CONSTRAINT IF EXISTS "instance_settings_signing_whole";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "signing_earlier";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "signing_since";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "signing_certificate";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "signing_key";
