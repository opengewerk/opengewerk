-- Rolling back the keys over the business.
--
-- What it costs an installation that runs it: every reference points at its
-- parent by id again, which is the state before and has the gap described in
-- the migration. No row changes; the rows that were checked stay as they are.
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_customer_in_tenant";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_site_in_tenant";
--> statement-breakpoint
ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_document_in_tenant";
--> statement-breakpoint
ALTER TABLE "document_files" DROP CONSTRAINT "document_files_document_in_tenant";
--> statement-breakpoint
ALTER TABLE "document_files" DROP CONSTRAINT "document_files_file_in_tenant";
--> statement-breakpoint
ALTER TABLE "document_snapshots" DROP CONSTRAINT "document_snapshots_document_in_tenant";
--> statement-breakpoint
ALTER TABLE "document_signatures" DROP CONSTRAINT "document_signatures_document_in_tenant";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_customer_in_tenant";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_job_in_tenant";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_site_in_tenant";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_installation_in_tenant";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_predecessor_in_tenant";
--> statement-breakpoint
ALTER TABLE "installations" DROP CONSTRAINT "installations_site_in_tenant";
--> statement-breakpoint
ALTER TABLE "document_instruction_choices" DROP CONSTRAINT "document_instruction_choices_document_in_tenant";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_customer_in_tenant";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_site_in_tenant";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_installation_in_tenant";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_parent_in_tenant";
--> statement-breakpoint
ALTER TABLE "letterheads" DROP CONSTRAINT "letterheads_logo_in_tenant";
--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_task_in_tenant";
--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_document_in_tenant";
--> statement-breakpoint
ALTER TABLE "mail_outbox" DROP CONSTRAINT "mail_outbox_invitation_in_tenant";
--> statement-breakpoint
ALTER TABLE "inverters" DROP CONSTRAINT "inverters_installation_in_tenant";
--> statement-breakpoint
ALTER TABLE "pv_modules" DROP CONSTRAINT "pv_modules_string_in_tenant";
--> statement-breakpoint
ALTER TABLE "pv_strings" DROP CONSTRAINT "pv_strings_inverter_in_tenant";
--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_customer_in_tenant";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_customer_in_tenant";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_site_in_tenant";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_job_in_tenant";
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "inverters" DROP CONSTRAINT "inverters_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "pv_strings" DROP CONSTRAINT "pv_strings_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_tenant_id_key";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_predecessor_document_id_documents_id_fk" FOREIGN KEY ("predecessor_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_instruction_choices" ADD CONSTRAINT "document_instruction_choices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_job_id_jobs_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "letterheads" ADD CONSTRAINT "letterheads_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_pv_string_id_pv_strings_id_fk" FOREIGN KEY ("pv_string_id") REFERENCES "public"."pv_strings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_inverter_id_inverters_id_fk" FOREIGN KEY ("inverter_id") REFERENCES "public"."inverters"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;
