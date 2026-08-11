ALTER TABLE "eval_runs" ADD COLUMN "run_batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer NOT NULL;--> statement-breakpoint
CREATE INDEX "eval_runs_run_batch_idx" ON "eval_runs" USING btree ("run_batch_id");