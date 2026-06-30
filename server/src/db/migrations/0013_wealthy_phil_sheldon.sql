ALTER TABLE "repos" ADD COLUMN "conventions_scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "conventions_sample_count" integer;