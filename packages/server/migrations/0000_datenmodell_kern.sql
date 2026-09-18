CREATE TYPE "public"."customer_kind" AS ENUM('private', 'business', 'property_management', 'general_contractor');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('cost_estimate', 'quote', 'order_confirmation', 'delivery_note', 'time_and_material_report', 'progress_invoice', 'partial_invoice', 'final_invoice', 'credit_note', 'cancellation_invoice', 'recurring_invoice');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."distribution_board_kind" AS ENUM('main_distribution', 'sub_distribution', 'meter_cabinet');--> statement-breakpoint
CREATE TYPE "public"."installation_kind" AS ENUM('pv_system', 'meter_cabinet', 'wallbox', 'heating', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('project', 'service');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"site_id" uuid,
	"given_name" text,
	"family_name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_belong_to_customer_or_site" CHECK (("contacts"."customer_id" is null) <> ("contacts"."site_id" is null))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "customer_kind" NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"street" text,
	"house_number" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"vat_id" text,
	"is_business" boolean DEFAULT false NOT NULL,
	"is_construction_service_recipient" boolean DEFAULT false NOT NULL,
	"tax_exemption_certificate_number" text,
	"tax_exemption_valid_until" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"job_id" uuid,
	"site_id" uuid,
	"installation_id" uuid,
	"predecessor_document_id" uuid,
	"kind" "document_kind" NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"document_date" date NOT NULL,
	"issued_at" timestamp with time zone,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"distribution_board_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_sections_id_board_key" UNIQUE("id","distribution_board_id")
);
--> statement-breakpoint
CREATE TABLE "circuits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"distribution_board_id" uuid NOT NULL,
	"board_section_id" uuid,
	"designation" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distribution_boards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"kind" "distribution_board_kind" NOT NULL,
	"designation" text NOT NULL,
	"location" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"circuit_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"kind" text,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "installation_kind" NOT NULL,
	"designation" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"commissioned_on" date,
	"warranty_ends_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid,
	"installation_id" uuid,
	"parent_job_id" uuid,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"designation" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inverters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pv_modules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pv_string_id" uuid NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pv_strings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inverter_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"street" text,
	"house_number" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_predecessor_document_id_documents_id_fk" FOREIGN KEY ("predecessor_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_distribution_board_id_distribution_boards_id_fk" FOREIGN KEY ("distribution_board_id") REFERENCES "public"."distribution_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_distribution_board_id_distribution_boards_id_fk" FOREIGN KEY ("distribution_board_id") REFERENCES "public"."distribution_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_section_belongs_to_board" FOREIGN KEY ("board_section_id","distribution_board_id") REFERENCES "public"."board_sections"("id","distribution_board_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_circuit_id_circuits_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."circuits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_job_id_jobs_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_pv_string_id_pv_strings_id_fk" FOREIGN KEY ("pv_string_id") REFERENCES "public"."pv_strings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_inverter_id_inverters_id_fk" FOREIGN KEY ("inverter_id") REFERENCES "public"."inverters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_customer_idx" ON "contacts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "contacts_site_idx" ON "contacts" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "documents_customer_idx" ON "documents" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "documents_job_idx" ON "documents" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "documents_predecessor_idx" ON "documents" USING btree ("predecessor_document_id");--> statement-breakpoint
CREATE INDEX "board_sections_board_idx" ON "board_sections" USING btree ("distribution_board_id");--> statement-breakpoint
CREATE INDEX "circuits_board_idx" ON "circuits" USING btree ("distribution_board_id");--> statement-breakpoint
CREATE INDEX "distribution_boards_installation_idx" ON "distribution_boards" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "equipment_circuit_idx" ON "equipment" USING btree ("circuit_id");--> statement-breakpoint
CREATE INDEX "installations_site_idx" ON "installations" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "jobs_customer_idx" ON "jobs" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "jobs_site_idx" ON "jobs" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "jobs_parent_idx" ON "jobs" USING btree ("parent_job_id");--> statement-breakpoint
CREATE INDEX "inverters_installation_idx" ON "inverters" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "pv_modules_string_idx" ON "pv_modules" USING btree ("pv_string_id");--> statement-breakpoint
CREATE INDEX "pv_strings_inverter_idx" ON "pv_strings" USING btree ("inverter_id");--> statement-breakpoint
CREATE INDEX "sites_customer_idx" ON "sites" USING btree ("tenant_id","customer_id");