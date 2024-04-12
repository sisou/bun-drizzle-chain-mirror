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

export const validatorPreregistrations = pgTable("validator_preregistrations", {
	address: char("address", { length: 44 }).primaryKey().references(() => accounts.address),
	transaction_01: bytea("transaction_01").references(() => transactions.hash, { onDelete: "set null" }),
	transaction_02: bytea("transaction_02").references(() => transactions.hash, { onDelete: "set null" }),
	transaction_03: bytea("transaction_03").references(() => transactions.hash, { onDelete: "set null" }),
	transaction_04: bytea("transaction_04").references(() => transactions.hash, { onDelete: "set null" }),
	transaction_05: bytea("transaction_05").references(() => transactions.hash, { onDelete: "set null" }),
	transaction_06: bytea("transaction_06").references(() => transactions.hash, { onDelete: "set null" }),
	deposit_transaction: bytea("deposit_transaction").references(() => transactions.hash, { onDelete: "set null" }),
	transaction_01_height: integer("transaction_01_height").references(() => blocks.height, { onDelete: "set null" }),
	deposit_transaction_height: integer("deposit_transaction_height").references(() => blocks.height, {
		onDelete: "set null",
	}),
}, (table) => ({
	transaction_01_height_idx: index("transaction_01_height_idx").on(table.transaction_01_height),
	deposit_transaction_height_idx: index("deposit_transaction_height_idx").on(table.deposit_transaction_height),
}));
export type ValidatorPreregistration = typeof validatorPreregistrations.$inferSelect;
export type ValidatorPreregistrationInsert = typeof validatorPreregistrations.$inferInsert;

export const prestakingStakers = pgTable("prestaking_stakers", {
	address: char("address", { length: 44 }).primaryKey().references(() => accounts.address),
	delegation: char("delegation", { length: 44 }).notNull(),
	transactions: bytea("transactions").array().notNull(),
	first_transaction_height: integer("first_transaction_height").notNull().references(() => blocks.height, {
		onDelete: "cascade",
	}),
	latest_transaction_height: integer("latest_transaction_height").notNull().references(() => blocks.height, {
		onDelete: "set null",
	}),
}, (table) => ({
	delegation_idx: index("delegation_idx").on(table.delegation),
	first_transaction_height_idx: index("first_transaction_height_idx").on(table.first_transaction_height),
	latest_transaction_height_idx: index("latest_transaction_height_idx").on(table.latest_transaction_height),
}));
export type PrestakingStaker = typeof prestakingStakers.$inferSelect;
export type PrestakingStakerInsert = typeof prestakingStakers.$inferInsert;
