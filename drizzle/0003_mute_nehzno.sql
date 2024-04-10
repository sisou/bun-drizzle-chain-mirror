CREATE TABLE IF NOT EXISTS "validator_preregistrations" (
	"address" char(44) PRIMARY KEY NOT NULL,
	"transaction_01" "bytea",
	"transaction_02" "bytea",
	"transaction_03" "bytea",
	"transaction_04" "bytea",
	"transaction_05" "bytea",
	"transaction_06" "bytea",
	"deposit_transaction" "bytea",
	"transaction_01_height" integer,
	"deposit_transaction_height" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_01_height_idx" ON "validator_preregistrations" ("transaction_01_height");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_transaction_height_idx" ON "validator_preregistrations" ("deposit_transaction_height");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_address_accounts_address_fk" FOREIGN KEY ("address") REFERENCES "accounts"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_transaction_01_transactions_hash_fk" FOREIGN KEY ("transaction_01") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_transaction_02_transactions_hash_fk" FOREIGN KEY ("transaction_02") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_transaction_03_transactions_hash_fk" FOREIGN KEY ("transaction_03") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_transaction_04_transactions_hash_fk" FOREIGN KEY ("transaction_04") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_transaction_05_transactions_hash_fk" FOREIGN KEY ("transaction_05") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_transaction_06_transactions_hash_fk" FOREIGN KEY ("transaction_06") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_deposit_transaction_transactions_hash_fk" FOREIGN KEY ("deposit_transaction") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_transaction_01_height_blocks_height_fk" FOREIGN KEY ("transaction_01_height") REFERENCES "blocks"("height") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_preregistrations" ADD CONSTRAINT "validator_preregistrations_deposit_transaction_height_blocks_height_fk" FOREIGN KEY ("deposit_transaction_height") REFERENCES "blocks"("height") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
