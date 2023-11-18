CREATE TABLE `accounts` (
	`address` text(44) PRIMARY KEY NOT NULL,
	`type` integer NOT NULL,
	`balance` integer NOT NULL,
	`creation_data` blob,
	`first_seen` integer NOT NULL,
	`last_sent` integer,
	`last_received` integer,
	FOREIGN KEY (`first_seen`) REFERENCES `blocks`(`height`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_sent`) REFERENCES `blocks`(`height`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_received`) REFERENCES `blocks`(`height`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`height` integer PRIMARY KEY NOT NULL,
	`timestamp_ms` integer NOT NULL,
	`hash` blob NOT NULL,
	`creator_address` text(44) NOT NULL,
	`transaction_count` integer NOT NULL,
	`value` integer NOT NULL,
	`fees` integer NOT NULL,
	`size` integer NOT NULL,
	`difficulty` integer NOT NULL,
	`extra_data` blob
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`hash` blob PRIMARY KEY NOT NULL,
	`block_height` integer NOT NULL,
	`timestamp_ms` integer NOT NULL,
	`sender_address` text(44) NOT NULL,
	`sender_type` integer NOT NULL,
	`sender_data` blob,
	`recipient_address` text(44) NOT NULL,
	`recipient_type` integer NOT NULL,
	`recipient_data` blob,
	`value` integer NOT NULL,
	`fee` integer NOT NULL,
	`validity_start_height` integer NOT NULL,
	`flags` integer NOT NULL,
	`proof` blob,
	FOREIGN KEY (`block_height`) REFERENCES `blocks`(`height`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_address`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_address`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `first_seen_idx` ON `accounts` (`first_seen`);--> statement-breakpoint
CREATE INDEX `last_sent_idx` ON `accounts` (`last_sent`);--> statement-breakpoint
CREATE INDEX `last_received_idx` ON `accounts` (`last_received`);--> statement-breakpoint
CREATE UNIQUE INDEX `block_hash_idx` ON `blocks` (`hash`);--> statement-breakpoint
CREATE INDEX `creator_address_idx` ON `blocks` (`creator_address`);--> statement-breakpoint
CREATE INDEX `block_height_idx` ON `transactions` (`block_height`);--> statement-breakpoint
CREATE INDEX `timestamp_ms_idx` ON `transactions` (`timestamp_ms`);--> statement-breakpoint
CREATE INDEX `sender_address_idx` ON `transactions` (`sender_address`);--> statement-breakpoint
CREATE INDEX `recipient_address_idx` ON `transactions` (`recipient_address`);