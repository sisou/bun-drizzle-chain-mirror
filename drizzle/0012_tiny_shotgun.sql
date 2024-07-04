ALTER TABLE "transactions" ALTER COLUMN "block_height" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "timestamp_ms" DROP NOT NULL;