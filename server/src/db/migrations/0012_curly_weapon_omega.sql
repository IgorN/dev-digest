ALTER TABLE "conventions" ALTER COLUMN "accepted" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "accepted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_start_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_end_line" integer;