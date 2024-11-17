ALTER TABLE "accounts" ALTER COLUMN "address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "creator_address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "prestakers" ALTER COLUMN "address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "prestakers" ALTER COLUMN "delegation" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "prestaking_transactions" ALTER COLUMN "staker_address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "sender_address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "recipient_address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "validator_registrations" ALTER COLUMN "address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "vesting_owners" ALTER COLUMN "address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "vesting_owners" ALTER COLUMN "owner" SET DATA TYPE text;