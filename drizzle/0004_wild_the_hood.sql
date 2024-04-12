CREATE TABLE IF NOT EXISTS "prestaking_stakers" (
	"address" char(44) PRIMARY KEY NOT NULL,
	"delegation" char(44) NOT NULL,
	"transactions" bytea[] NOT NULL,
	"first_transaction_height" integer NOT NULL,
	"latest_transaction_height" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delegation_idx" ON "prestaking_stakers" ("delegation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "first_transaction_height_idx" ON "prestaking_stakers" ("first_transaction_height");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "latest_transaction_height_idx" ON "prestaking_stakers" ("latest_transaction_height");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestaking_stakers" ADD CONSTRAINT "prestaking_stakers_address_accounts_address_fk" FOREIGN KEY ("address") REFERENCES "accounts"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
