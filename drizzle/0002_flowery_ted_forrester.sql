ALTER TABLE "accounts" DROP CONSTRAINT "accounts_last_received_blocks_height_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_last_received_blocks_height_fk" FOREIGN KEY ("last_received") REFERENCES "blocks"("height") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
