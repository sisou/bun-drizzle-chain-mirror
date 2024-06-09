CREATE TABLE IF NOT EXISTS "vesting_owners" (
	"address" char(44) PRIMARY KEY NOT NULL,
	"owner" char(44) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "address_idx" ON "vesting_owners" ("address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owner_idx" ON "vesting_owners" ("owner");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vesting_owners" ADD CONSTRAINT "vesting_owners_address_accounts_address_fk" FOREIGN KEY ("address") REFERENCES "accounts"("address") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vesting_owners" ADD CONSTRAINT "vesting_owners_owner_accounts_address_fk" FOREIGN KEY ("owner") REFERENCES "accounts"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
