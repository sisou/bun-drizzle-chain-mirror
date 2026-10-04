DROP INDEX "inherent_target_address_idx";--> statement-breakpoint
CREATE INDEX "inherent_target_address_height_idx" ON "inherents" USING btree ("target_address","block_height");