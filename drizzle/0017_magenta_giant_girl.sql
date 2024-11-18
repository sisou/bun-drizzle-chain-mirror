CREATE TABLE IF NOT EXISTS "epochs" (
	"number" integer PRIMARY KEY NOT NULL,
	"block_height" integer NOT NULL,
	"elected_validators" text[] NOT NULL,
	"validator_slots" integer[] NOT NULL,
	"votes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inherents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"block_height" integer NOT NULL,
	"timestamp_ms" timestamp (3) NOT NULL,
	"validator_address" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "timestamp_ms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "creator_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "difficulty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "inherent_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "related_addresses" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epoch_block_height_idx" ON "epochs" ("block_height");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epoch_elected_validators_idx" ON "epochs" ("elected_validators");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inherent_type_idx" ON "inherents" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inherent_block_height_idx" ON "inherents" ("block_height");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inherent_validator_address_idx" ON "inherents" ("validator_address");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "epochs" ADD CONSTRAINT "epochs_block_height_blocks_height_fk" FOREIGN KEY ("block_height") REFERENCES "blocks"("height") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inherents" ADD CONSTRAINT "inherents_block_height_blocks_height_fk" FOREIGN KEY ("block_height") REFERENCES "blocks"("height") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
