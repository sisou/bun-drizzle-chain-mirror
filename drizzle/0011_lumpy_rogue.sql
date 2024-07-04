ALTER TABLE "prestakers" DROP CONSTRAINT "prestakers_address_accounts_address_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_sender_address_accounts_address_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_recipient_address_accounts_address_fk";
--> statement-breakpoint
ALTER TABLE "validator_registrations" DROP CONSTRAINT "validator_registrations_address_accounts_address_fk";
