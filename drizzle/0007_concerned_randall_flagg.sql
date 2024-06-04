DROP INDEX IF EXISTS "timestamp_ms_idx";--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "timestamp_ms" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "timestamp_ms" SET DATA TYPE timestamp (3);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "date_idx" ON "transactions" ("timestamp_ms");