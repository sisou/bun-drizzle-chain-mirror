import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const blocks = sqliteTable("blocks", {
	height: integer("height").primaryKey(),
	timestamp_ms: integer("timestamp_ms", { mode: "timestamp_ms" }).notNull(),
	hash: blob("hash", { mode: "buffer" }).notNull(),
	creator_address: text("creator_address", { length: 44 }).notNull(),
	transaction_count: integer("transaction_count").notNull(),
	value: integer("value").notNull(),
	fees: integer("fees").notNull(),
	size: integer("size").notNull(),
	difficulty: integer("difficulty").notNull(),
	extra_data: blob("extra_data", { mode: "buffer" }),
}, (table) => ({
	block_hash_idx: uniqueIndex("block_hash_idx").on(table.hash),
	creator_address_idx: index("creator_address_idx").on(table.creator_address),
}));
export type Block = typeof blocks.$inferSelect;
export type BlockInsert = typeof blocks.$inferInsert;

export const transactions = sqliteTable("transactions", {
	hash: blob("hash", { mode: "buffer" }).primaryKey(),
	block_height: integer("block_height").notNull().references(() => blocks.height, { onDelete: "cascade" }),
	timestamp_ms: integer("timestamp_ms", { mode: "timestamp_ms" }).notNull(),
	sender_address: text("sender_address", { length: 44 }).notNull().references(() => accounts.address),
	sender_type: integer("sender_type").notNull(),
	sender_data: blob("sender_data", { mode: "buffer" }),
	recipient_address: text("recipient_address", { length: 44 }).notNull().references(() => accounts.address),
	recipient_type: integer("recipient_type").notNull(),
	recipient_data: blob("recipient_data", { mode: "buffer" }),
	value: integer("value").notNull(),
	fee: integer("fee").notNull(),
	validity_start_height: integer("validity_start_height").notNull(),
	flags: integer("flags").notNull(),
	proof: blob("proof", { mode: "buffer" }),
}, (table) => ({
	block_height_idx: index("block_height_idx").on(table.block_height),
	timestamp_ms_idx: index("timestamp_ms_idx").on(table.timestamp_ms),
	sender_address_idx: index("sender_address_idx").on(table.sender_address),
	recipient_address_idx: index("recipient_address_idx").on(table.recipient_address),
}));
export type Transaction = typeof transactions.$inferSelect;
export type TransactionInsert = typeof transactions.$inferInsert;

export const accounts = sqliteTable("accounts", {
	address: text("address", { length: 44 }).primaryKey(),
	type: integer("type").notNull(),
	balance: integer("balance").notNull(),
	creation_data: blob("creation_data", { mode: "buffer" }), // Only for contracts
	first_seen: integer("first_seen").notNull().references(() => blocks.height, { onDelete: "cascade" }),
	last_sent: integer("last_sent").references(() => blocks.height),
	last_received: integer("last_received").references(() => blocks.height),
}, (table) => ({
	first_seen_idx: index("first_seen_idx").on(table.first_seen),
	last_sent_idx: index("last_sent_idx").on(table.last_sent),
	last_received_idx: index("last_received_idx").on(table.last_received),
}));
export type Account = typeof accounts.$inferSelect;
export type AccountInsert = typeof accounts.$inferInsert;
