CREATE TABLE IF NOT EXISTS "prestaking_transactions" (
	"transaction_hash" "bytea" NOT NULL,
	"staker_address" char(44) NOT NULL,
	CONSTRAINT "prestaking_transactions_transaction_hash_unique" UNIQUE("transaction_hash")
);
--> statement-breakpoint
ALTER TABLE "prestaking_stakers" RENAME TO "prestakers";--> statement-breakpoint
ALTER TABLE "validator_preregistrations" RENAME TO "validator_registrations";--> statement-breakpoint
ALTER TABLE "prestakers" DROP CONSTRAINT "prestaking_stakers_address_accounts_address_fk";
--> statement-breakpoint
ALTER TABLE "prestakers" DROP CONSTRAINT "prestaking_stakers_first_transaction_height_blocks_height_fk";
--> statement-breakpoint
ALTER TABLE "prestakers" DROP CONSTRAINT "prestaking_stakers_latest_transaction_height_blocks_height_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_address_accounts_address_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_transaction_01_transactions_hash_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_transaction_02_transactions_hash_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_transaction_03_transactions_hash_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_transaction_04_transactions_hash_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_transaction_05_transactions_hash_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_transaction_06_transactions_hash_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_deposit_transaction_transactions_hash_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_transaction_01_height_blocks_height_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_preregistrations_deposit_transaction_height_blocks_height_fk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staker_address_idx" ON "prestaking_transactions" ("staker_address");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestakers" ADD CONSTRAINT "prestakers_address_accounts_address_fk" FOREIGN KEY ("address") REFERENCES "accounts"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestakers" ADD CONSTRAINT "prestakers_first_transaction_height_blocks_height_fk" FOREIGN KEY ("first_transaction_height") REFERENCES "blocks"("height") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestakers" ADD CONSTRAINT "prestakers_latest_transaction_height_blocks_height_fk" FOREIGN KEY ("latest_transaction_height") REFERENCES "blocks"("height") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_address_accounts_address_fk" FOREIGN KEY ("address") REFERENCES "accounts"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_transaction_01_transactions_hash_fk" FOREIGN KEY ("transaction_01") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_transaction_02_transactions_hash_fk" FOREIGN KEY ("transaction_02") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_transaction_03_transactions_hash_fk" FOREIGN KEY ("transaction_03") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_transaction_04_transactions_hash_fk" FOREIGN KEY ("transaction_04") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_transaction_05_transactions_hash_fk" FOREIGN KEY ("transaction_05") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_transaction_06_transactions_hash_fk" FOREIGN KEY ("transaction_06") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_deposit_transaction_transactions_hash_fk" FOREIGN KEY ("deposit_transaction") REFERENCES "transactions"("hash") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_transaction_01_height_blocks_height_fk" FOREIGN KEY ("transaction_01_height") REFERENCES "blocks"("height") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validator_registrations" ADD CONSTRAINT "validator_registrations_deposit_transaction_height_blocks_height_fk" FOREIGN KEY ("deposit_transaction_height") REFERENCES "blocks"("height") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "prestakers" DROP COLUMN IF EXISTS "transactions";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestaking_transactions" ADD CONSTRAINT "prestaking_transactions_transaction_hash_transactions_hash_fk" FOREIGN KEY ("transaction_hash") REFERENCES "transactions"("hash") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestaking_transactions" ADD CONSTRAINT "prestaking_transactions_staker_address_prestakers_address_fk" FOREIGN KEY ("staker_address") REFERENCES "prestakers"("address") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
