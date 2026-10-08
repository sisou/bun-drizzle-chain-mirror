DROP INDEX "epoch_elected_validators_idx";--> statement-breakpoint
DROP INDEX "inherent_type_idx";--> statement-breakpoint
DROP INDEX "delegation_idx";--> statement-breakpoint
DROP INDEX "staker_address_idx";--> statement-breakpoint
DROP INDEX "address_idx";--> statement-breakpoint
CREATE INDEX "block_date_idx" ON "blocks" USING btree ("timestamp_ms");--> statement-breakpoint
CREATE INDEX "inherent_type_height_idx" ON "inherents" USING btree ("type","block_height");--> statement-breakpoint
CREATE INDEX "sender_address_to_staking_height_idx" ON "transactions" USING btree ("sender_address","block_height") WHERE "transactions"."recipient_type" = 3;--> statement-breakpoint
CREATE INDEX "recipient_address_from_staking_height_idx" ON "transactions" USING btree ("recipient_address","block_height") WHERE "transactions"."sender_type" = 3;