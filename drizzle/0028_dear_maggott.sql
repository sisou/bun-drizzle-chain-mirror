-- I manually added the IF NOT EXISTS part of the statements, as Drizzle does not add it (understandibly).
-- I ran these statements manually with CONCURRENTLY, before applying the migration, that's why we need the IF NOT EXISTS, so the migration doesn't fail.

CREATE INDEX IF NOT EXISTS "sender_address_height_idx" ON "transactions" USING btree ("sender_address","block_height");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipient_address_height_idx" ON "transactions" USING btree ("recipient_address","block_height");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "failed_block_height_idx" ON "transactions" USING btree ("block_height") WHERE NOT "transactions"."executed";
