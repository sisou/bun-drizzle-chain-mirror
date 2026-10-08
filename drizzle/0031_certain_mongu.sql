CREATE INDEX "delegation_idx" ON "prestakers" USING btree ("delegation");--> statement-breakpoint
CREATE INDEX "staker_address_idx" ON "prestaking_transactions" USING btree ("staker_address");--> statement-breakpoint
CREATE INDEX "restake_time_window_idx" ON "restake_transactions_grouped" USING btree ("time_window");