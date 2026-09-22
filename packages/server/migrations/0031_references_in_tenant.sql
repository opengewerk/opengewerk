-- Every reference between two records of a business runs over the business: #113.
--
-- The statements after the check come from the schema, reordered by hand so
-- that the unique keys exist before the foreign keys that point at them.
-- Everything else is written by hand.
--
-- PostgreSQL checks a foreign key past row level security, so a key on `id`
-- alone takes the id of a record of another business. Measured on 22.09.2026
-- through the role of the application: an installation was accepted on a site
-- of another business. Nobody reads anything that way, every query stays
-- behind the policy; but the row hangs across the border, a cascade there
-- takes it along, and a `restrict` here keeps the other business from
-- removing its own record. 0019 did it right for the person of a task, 0030
-- for the structure below an installation, and this does it for the 29 keys
-- that were left: each one now runs over tenant and id, against a unique key
-- over the same two columns on the parent.
--
-- **Nothing is bent into shape.** A row that already points into another
-- business would make its key fail with a sentence about a constraint. The
-- check below looks first and stops the update with the tables, columns and
-- counts instead, and since every pending migration runs in one transaction,
-- the database stays as it was. Which rows they are, the same query shows
-- with `select s.*` in place of the count, for the installations of the
-- message `installations.site_id` for instance:
--
--   select s.* from installations s join sites t on t.id = s.site_id
--    where t.tenant_id <> s.tenant_id;
--
-- run as the superuser the backup uses, since the owner sees nothing, for the
-- reason in the next paragraph. Deciding where they belong is a person's job,
-- not a migration's.
--
-- **The check has to see the rows.** Migrations run as the owner of the
-- tables, every table of a business stands on FORCE ROW LEVEL SECURITY, and
-- no policy names the owner, so a plain count finds nothing and the check
-- would pass on any database. It switches FORCE off on the tables it reads,
-- for the length of the check and inside the transaction, and back on before
-- it decides; a failure takes the switch back with everything else.
DO $$
DECLARE
	reference record;
	offending bigint;
	crossings text[] := '{}';
	opened text[] := '{}';
	relation text;
BEGIN
	FOR reference IN
		SELECT * FROM (VALUES
			('contacts', 'customer_id', 'customers'),
			('contacts', 'site_id', 'sites'),
			('document_lines', 'document_id', 'documents'),
			('document_files', 'document_id', 'documents'),
			('document_files', 'file_id', 'files'),
			('document_snapshots', 'document_id', 'documents'),
			('document_signatures', 'document_id', 'documents'),
			('documents', 'customer_id', 'customers'),
			('documents', 'job_id', 'jobs'),
			('documents', 'site_id', 'sites'),
			('documents', 'installation_id', 'installations'),
			('documents', 'predecessor_document_id', 'documents'),
			('installations', 'site_id', 'sites'),
			('document_instruction_choices', 'document_id', 'documents'),
			('jobs', 'customer_id', 'customers'),
			('jobs', 'site_id', 'sites'),
			('jobs', 'installation_id', 'installations'),
			('jobs', 'parent_job_id', 'jobs'),
			('letterheads', 'logo_file_id', 'files'),
			('mail_outbox', 'task_id', 'tasks'),
			('mail_outbox', 'document_id', 'documents'),
			('mail_outbox', 'invitation_id', 'invitations'),
			('inverters', 'installation_id', 'installations'),
			('pv_modules', 'pv_string_id', 'pv_strings'),
			('pv_strings', 'inverter_id', 'inverters'),
			('sites', 'customer_id', 'customers'),
			('tasks', 'customer_id', 'customers'),
			('tasks', 'site_id', 'sites'),
			('tasks', 'job_id', 'jobs')
		) AS pairs(source, referencing, target)
	LOOP
		FOREACH relation IN ARRAY ARRAY[reference.source, reference.target] LOOP
			IF NOT relation = ANY (opened) THEN
				EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', relation);
				opened := opened || relation;
			END IF;
		END LOOP;

		EXECUTE format(
			'SELECT count(*) FROM %I s JOIN %I t ON t.id = s.%I WHERE t.tenant_id <> s.tenant_id',
			reference.source, reference.target, reference.referencing
		) INTO offending;

		IF offending > 0 THEN
			crossings := crossings || format('%s.%s mit %s %s', reference.source,
				reference.referencing, offending,
				CASE WHEN offending = 1 THEN 'Zeile' ELSE 'Zeilen' END);
		END IF;
	END LOOP;

	FOREACH relation IN ARRAY opened LOOP
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation);
	END LOOP;

	IF cardinality(crossings) > 0 THEN
		RAISE EXCEPTION 'Diese Verweise zeigen schon auf Datensätze eines anderen Betriebs: %. Das Update biegt daran nichts um und bricht ab, die Datenbank bleibt auf dem Stand davor. Welche Zeilen es sind, zeigt die Abfrage aus Migration 0031; erst richtigstellen, dann erneut starten.',
			array_to_string(crossings, ', ');
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_site_id_sites_id_fk";--> statement-breakpoint
ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_files" DROP CONSTRAINT "document_files_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_files" DROP CONSTRAINT "document_files_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "document_snapshots" DROP CONSTRAINT "document_snapshots_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_signatures" DROP CONSTRAINT "document_signatures_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_job_id_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_site_id_sites_id_fk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_installation_id_installations_id_fk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_predecessor_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_site_id_sites_id_fk";--> statement-breakpoint
ALTER TABLE "document_instruction_choices" DROP CONSTRAINT "document_instruction_choices_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_site_id_sites_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_installation_id_installations_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_parent_job_id_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "letterheads" DROP CONSTRAINT "letterheads_logo_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_invitation_id_invitations_id_fk";--> statement-breakpoint
ALTER TABLE "inverters" DROP CONSTRAINT "inverters_installation_id_installations_id_fk";--> statement-breakpoint
ALTER TABLE "pv_modules" DROP CONSTRAINT "pv_modules_pv_string_id_pv_strings_id_fk";--> statement-breakpoint
ALTER TABLE "pv_strings" DROP CONSTRAINT "pv_strings_inverter_id_inverters_id_fk";--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_site_id_sites_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_job_id_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_file_in_tenant" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_predecessor_in_tenant" FOREIGN KEY ("tenant_id","predecessor_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_instruction_choices" ADD CONSTRAINT "document_instruction_choices_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_in_tenant" FOREIGN KEY ("tenant_id","parent_job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letterheads" ADD CONSTRAINT "letterheads_logo_in_tenant" FOREIGN KEY ("tenant_id","logo_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_task_in_tenant" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_document_in_tenant" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_invitation_in_tenant" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."invitations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_installation_in_tenant" FOREIGN KEY ("tenant_id","installation_id") REFERENCES "public"."installations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_string_in_tenant" FOREIGN KEY ("tenant_id","pv_string_id") REFERENCES "public"."pv_strings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_inverter_in_tenant" FOREIGN KEY ("tenant_id","inverter_id") REFERENCES "public"."inverters"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_in_tenant" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_site_in_tenant" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_in_tenant" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
