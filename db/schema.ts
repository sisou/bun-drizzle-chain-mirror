import {
	bigint,
	char,
	customType,
	date,
	index,
	integer,
	pgTable,
	real,
	smallint,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: string; notNull: false; default: false }>({
	dataType() {
		return "bytea";
	},
	toDriver(val) {
		return Buffer.from(val.startsWith("0x") ? val.slice(2) : val, "hex");
	},
	fromDriver(val) {
		if (val instanceof Buffer) return val.toString("hex");
		throw new Error(`Expected Buffer, got ${typeof val}`);
	},
});

export const blocks = pgTable("blocks", {
	height: integer("height").primaryKey(),
	date: date("timestamp_ms", { mode: "date" }).notNull(),
	hash: bytea("hash").notNull(),
	creator_address: char("creator_address", { length: 44 }).notNull(),
	transaction_count: integer("transaction_count").notNull(),
	value: bigint("value", { mode: "number" }).notNull(),
	fees: bigint("fees", { mode: "number" }).notNull(),
	size: integer("size").notNull(),
	difficulty: real("difficulty").notNull(),
	extra_data: bytea("extra_data"),
}, (table) => ({
	block_hash_idx: uniqueIndex("block_hash_idx").on(table.hash),
	creator_address_idx: index("creator_address_idx").on(table.creator_address),
}));
export type Block = typeof blocks.$inferSelect;
export type BlockInsert = typeof blocks.$inferInsert;

export const transactions = pgTable("transactions", {
	hash: bytea("hash").primaryKey(),
	block_height: integer("block_height").notNull().references(() => blocks.height, { onDelete: "cascade" }),
	timestamp_ms: date("timestamp_ms", { mode: "date" }).notNull(),
	sender_address: char("sender_address", { length: 44 }).notNull().references(() => accounts.address),
	sender_type: smallint("sender_type").notNull(),
	sender_data: bytea("sender_data"),
	recipient_address: char("recipient_address", { length: 44 }).notNull().references(() => accounts.address),
	recipient_type: smallint("recipient_type").notNull(),
	recipient_data: bytea("recipient_data"),
	value: bigint("value", { mode: "number" }).notNull(),
	fee: bigint("fee", { mode: "number" }).notNull(),
	validity_start_height: integer("validity_start_height").notNull(),
	flags: smallint("flags").notNull(),
	proof: bytea("proof"),
}, (table) => ({
	block_height_idx: index("block_height_idx").on(table.block_height),
	timestamp_ms_idx: index("timestamp_ms_idx").on(table.timestamp_ms),
	sender_address_idx: index("sender_address_idx").on(table.sender_address),
	recipient_address_idx: index("recipient_address_idx").on(table.recipient_address),
}));
export type Transaction = typeof transactions.$inferSelect;
export type TransactionInsert = typeof transactions.$inferInsert;

export const accounts = pgTable("accounts", {
	address: char("address", { length: 44 }).primaryKey(),
	type: integer("type").notNull(),
	balance: bigint("balance", { mode: "number" }).notNull(),
	creation_data: bytea("creation_data"), // Only for contracts
	first_seen: integer("first_seen").references(() => blocks.height, { onDelete: "cascade" }),
	last_sent: integer("last_sent").references(() => blocks.height, { onDelete: "set null" }),
	last_received: integer("last_received").references(() => blocks.height, { onDelete: "set null" }),
}, (table) => ({
	first_seen_idx: index("first_seen_idx").on(table.first_seen),
	last_sent_idx: index("last_sent_idx").on(table.last_sent),
	last_received_idx: index("last_received_idx").on(table.last_received),
}));
export type Account = typeof accounts.$inferSelect;
export type AccountInsert = typeof accounts.$inferInsert;
