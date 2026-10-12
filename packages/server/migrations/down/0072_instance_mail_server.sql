-- Takes the mail server of the instance out again, back to how 0071 left
-- things.
--
-- The columns go without asking, the sealed password with them. What the log
-- of the instance said about them it keeps. After this nothing goes out to an
-- account by mail until a version is running that sends it some other way.
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
		 WHERE NOT (k.field = ANY (ARRAY['updated_at', 'updated_by', 'version', 'change_sequence']))
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
ALTER TABLE "instance_settings" DROP CONSTRAINT IF EXISTS "instance_settings_mail_server_port";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP CONSTRAINT IF EXISTS "instance_settings_mail_server_login";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP CONSTRAINT IF EXISTS "instance_settings_mail_server_whole";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "mail_server_password_set_at";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "mail_server_password";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "mail_server_from";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "mail_server_username";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "mail_server_security";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "mail_server_port";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "mail_server_host";
