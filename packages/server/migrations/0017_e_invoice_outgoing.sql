-- The outgoing e-invoice, issue #75.
--
-- An XRechnung is a file of an issued document like its PDF, stored the first
-- time somebody asks for it and never again, so it is a second purpose of
-- `document_files` and not a table of its own. The table and its trigger were
-- built for exactly this.
--
-- A business states whether it claims the transition of section 27 (38)
-- sentence 1 number 2 UStG, the one that ties the duty of 2027 to the turnover
-- of the year before. A setting with a period of validity, like the small
-- business claim next to it.
--
-- The Käuferreferenz sits with the customer, because a public authority has
-- one Leitweg-ID and not one per invoice. Nullable: most customers never give
-- one, and only an XRechnung asks for it.
--
-- Adding a value to an enum inside the transaction all pending migrations run
-- in is allowed since PostgreSQL 12; using it in the same transaction is not,
-- and nothing below does.
ALTER TYPE "public"."document_file_purpose" ADD VALUE 'xrechnung';--> statement-breakpoint
ALTER TYPE "public"."tenant_parameter_key" ADD VALUE 'e_invoice.transition_claimed';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "buyer_reference" text;
