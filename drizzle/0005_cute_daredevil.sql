DO $$ BEGIN
 ALTER TABLE "prestaking_stakers" ADD CONSTRAINT "prestaking_stakers_first_transaction_height_blocks_height_fk" FOREIGN KEY ("first_transaction_height") REFERENCES "blocks"("height") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestaking_stakers" ADD CONSTRAINT "prestaking_stakers_latest_transaction_height_blocks_height_fk" FOREIGN KEY ("latest_transaction_height") REFERENCES "blocks"("height") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
