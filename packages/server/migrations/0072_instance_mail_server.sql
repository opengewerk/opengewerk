-- The mail server of the instance (opengewerk-haustechnik#81): what goes to an
-- account, the link to a new password and the notice of a new passkey, goes
-- out through a mail server whoever runs the instance sets up, and through the
-- mail server of no business.
--
-- **Why columns on the settings of the instance.** There is one mail server
-- of the instance or none, and the settings of the instance are the one row
-- that belongs to no business. The three checks hold the columns to that: a
-- server comes with its port, its kind of connection and the address it
-- writes from, or none of them is set; a password goes with a login.
--
-- **Why the trigger changes.** The password is sealed with the key of the
-- instance and kept in `mail_server_password`. The log of the instance is
-- read by everybody who runs it and is never shortened, so it does not hold
-- the password, sealed or not: the trigger leaves the column out, and the
-- column beside it says when a password was set.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this migration runs on unchanged: it reads and writes the columns it
-- knows, and every new one may be null.

ALTER TABLE "instance_settings" ADD COLUMN "mail_server_host" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_server_port" integer;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_server_security" "mail_security";--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_server_username" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_server_from" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_server_password" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_server_password_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_mail_server_whole" CHECK (("instance_settings"."mail_server_host" is null) = ("instance_settings"."mail_server_port" is null)
        and ("instance_settings"."mail_server_host" is null) = ("instance_settings"."mail_server_security" is null)
        and ("instance_settings"."mail_server_host" is null) = ("instance_settings"."mail_server_from" is null)
        and ("instance_settings"."mail_server_host" is not null or ("instance_settings"."mail_server_username" is null and "instance_settings"."mail_server_password" is null)));--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_mail_server_login" CHECK (("instance_settings"."mail_server_password" is null or "instance_settings"."mail_server_username" is not null)
        and ("instance_settings"."mail_server_password" is null) = ("instance_settings"."mail_server_password_set_at" is null));--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_mail_server_port" CHECK ("instance_settings"."mail_server_port" is null or "instance_settings"."mail_server_port" between 1 and 65535);--> statement-breakpoint

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
$$;
