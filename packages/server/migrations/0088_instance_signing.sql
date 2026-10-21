-- The key the instance signs PDFs with (opengewerk-haustechnik#457): an
-- application that signs makes it with the first PDF that shows a signature,
-- or whoever runs the instance makes a new one in its settings. The
-- Handwerkersoftware signs nothing yet; it gets the columns because the
-- settings of the instance are a table of the foundation.
--
-- **Why columns on the settings of the instance.** There is one key of the
-- instance or none, like its mail server. The certificates of the keys before
-- stay beside it, so that a PDF signed with one of them is still known as one
-- of this instance. A key comes with its certificate and the moment it was
-- made, or none of them is set.
--
-- **Why the trigger changes.** The key is sealed with the key of the instance
-- and kept in `signing_key`. The log of the instance is read by everybody who
-- runs it and is never shortened, so it does not hold the key, sealed or not:
-- the trigger leaves the column out, as it does the password of the mail
-- server. The certificate is no secret and stays in the log.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this migration runs on unchanged: it reads and writes the columns it
-- knows, and every new one may be null or has its default.

ALTER TABLE "instance_settings" ADD COLUMN "signing_key" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "signing_certificate" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "signing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "signing_earlier" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_signing_whole" CHECK (("instance_settings"."signing_key" is null) = ("instance_settings"."signing_certificate" is null)
        and ("instance_settings"."signing_key" is null) = ("instance_settings"."signing_since" is null));--> statement-breakpoint

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
		 WHERE NOT (k.field = ANY (ARRAY['updated_at', 'updated_by', 'version', 'change_sequence', 'mail_server_password', 'signing_key']))
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
