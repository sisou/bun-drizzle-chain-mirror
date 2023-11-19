CREATE TABLE IF NOT EXISTS "accounts" (
	"address" char(44) PRIMARY KEY NOT NULL,
	"type" integer NOT NULL,
	"balance" bigint NOT NULL,
	"creation_data" "bytea",
	"first_seen" integer,
	"last_sent" integer,
	"last_received" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blocks" (
	"height" integer PRIMARY KEY NOT NULL,
	"timestamp_ms" date NOT NULL,
	"hash" "bytea" NOT NULL,
	"creator_address" char(44) NOT NULL,
	"transaction_count" integer NOT NULL,
	"value" bigint NOT NULL,
	"fees" bigint NOT NULL,
	"size" integer NOT NULL,
	"difficulty" real NOT NULL,
	"extra_data" "bytea"
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"hash" "bytea" PRIMARY KEY NOT NULL,
	"block_height" integer NOT NULL,
	"timestamp_ms" date NOT NULL,
	"sender_address" char(44) NOT NULL,
	"sender_type" smallint NOT NULL,
	"sender_data" "bytea",
	"recipient_address" char(44) NOT NULL,
	"recipient_type" smallint NOT NULL,
	"recipient_data" "bytea",
	"value" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"validity_start_height" integer NOT NULL,
	"flags" smallint NOT NULL,
	"proof" "bytea"
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "first_seen_idx" ON "accounts" ("first_seen");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "last_sent_idx" ON "accounts" ("last_sent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "last_received_idx" ON "accounts" ("last_received");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "block_hash_idx" ON "blocks" ("hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creator_address_idx" ON "blocks" ("creator_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "block_height_idx" ON "transactions" ("block_height");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timestamp_ms_idx" ON "transactions" ("timestamp_ms");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sender_address_idx" ON "transactions" ("sender_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipient_address_idx" ON "transactions" ("recipient_address");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_first_seen_blocks_height_fk" FOREIGN KEY ("first_seen") REFERENCES "blocks"("height") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_last_sent_blocks_height_fk" FOREIGN KEY ("last_sent") REFERENCES "blocks"("height") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_last_received_blocks_height_fk" FOREIGN KEY ("last_received") REFERENCES "blocks"("height") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_block_height_blocks_height_fk" FOREIGN KEY ("block_height") REFERENCES "blocks"("height") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sender_address_accounts_address_fk" FOREIGN KEY ("sender_address") REFERENCES "accounts"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recipient_address_accounts_address_fk" FOREIGN KEY ("recipient_address") REFERENCES "accounts"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
