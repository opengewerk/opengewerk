ALTER TABLE "articles" ADD COLUMN "durability_half_years" integer;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "durability_producer" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "durability_model" text;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_durability_whole" CHECK (("articles"."durability_half_years" is null) = ("articles"."durability_producer" is null)
          and ("articles"."durability_half_years" is null) = ("articles"."durability_model" is null));--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_durability_fits" CHECK ("articles"."durability_half_years" between 5 and 100
          and char_length("articles"."durability_producer") <= 20
          and char_length("articles"."durability_model") <= 20);