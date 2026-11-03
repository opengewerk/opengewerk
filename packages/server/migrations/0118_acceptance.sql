-- The acceptance of a job after § 640 BGB and the warranty from it (#310,
-- Feature-Gliederung v2.60).
--
-- **`form_records`** may hang on a job alone: the acceptance is a form of the
-- job, not of an installation or an appliance. The check `form_records_one_subject`
-- is put up anew with that third case, and an index on the job comes with it.
--
-- **`jobs`** gains `vob_agreed` (false for every job there is) and
-- `building_work` (empty, the job suggests one until the business decides).
--
-- **`installations`** gains `manufacturer_warranty_ends_on`, the guarantee of
-- the manufacturer apart from the warranty of the business; empty for all.
--
-- Everything comes from the schema. The check is dropped and put up again in
-- one transaction; every row there is hangs on an installation or an
-- appliance and keeps fitting it.
--
-- **Fits the version before it**: it writes no form of a job alone, writes a
-- job and an installation without the new columns, which keeps their default,
-- and a form of a job written by this version is one whose definition it does
-- not know and shows nowhere.
ALTER TABLE "form_records" DROP CONSTRAINT "form_records_one_subject";--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "manufacturer_warranty_ends_on" date;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "vob_agreed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "building_work" boolean;--> statement-breakpoint
CREATE INDEX "form_records_job_idx" ON "form_records" USING btree ("tenant_id","job_id");--> statement-breakpoint
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_one_subject" CHECK (num_nonnulls("form_records"."installation_id", "form_records"."appliance_id") = 1
        or ("form_records"."installation_id" is null and "form_records"."appliance_id" is null and "form_records"."job_id" is not null));