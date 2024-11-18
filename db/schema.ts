import { relations, sql } from "drizzle-orm";
import {
	bigint,
	bigserial,
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	smallint,
	text,
	timestamp,
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
		if (val instanceof Uint8Array) return Buffer.from(val).toString("hex");
		if (val instanceof Buffer) return val.toString("hex");
		if (typeof val === "string" && val.startsWith("\\x")) return val.substring(2);
		throw new Error(`Expected Buffer, got ${typeof val}: ${val}`);
	},
});

/**
 * The only fields we can know for past blocks that we cannot query anymore:
 * - height (duh)
 * - transaction_count
 * - inherent_count
 * - value
 * - fees
 *
 * These fields we _can_ know when the block has transactions or inherents:
 * - date
 *
 * These fields we can only know for current blocks:
 * - hash
 * - creator_address
 * - size
 * - extra_data
 *
 * These fields will not be populated in PoS:
 * - difficulty
 */
export const blocks = pgTable("blocks", {
	height: integer("height").primaryKey(),
	date: timestamp("timestamp_ms", { mode: "date", precision: 3 }),
	hash: bytea("hash"),
	creator_address: text("creator_address"),
	transaction_count: integer("transaction_count").notNull(),
	inherent_count: integer("inherent_count").notNull(),
	value: bigint("value", { mode: "number" }).notNull(),
	fees: bigint("fees", { mode: "number" }).notNull(),
	size: integer("size"),
	difficulty: real("difficulty"),
	extra_data: bytea("extra_data"),
}, (table) => ({
	block_hash_idx: uniqueIndex("block_hash_idx").on(table.hash),
	creator_address_idx: index("creator_address_idx").on(table.creator_address),
}));
export type Block = typeof blocks.$inferSelect;
export type BlockInsert = typeof blocks.$inferInsert;

export const blocksRelations = relations(blocks, ({ many, one }) => ({
	transactions: many(transactions),
	inherents: many(inherents),
	creator: one(accounts, {
		fields: [blocks.creator_address],
		references: [accounts.address],
	}),
	epochs: many(epochs),
}));

export const epochs = pgTable("epochs", {
	number: integer("number").primaryKey(),
	block_height: integer("block_height").notNull().references(() => blocks.height, { onDelete: "cascade" }),
	elected_validators: text("elected_validators").array().notNull(),
	validator_slots: integer("validator_slots").array().notNull(),
	votes: integer("votes").notNull(),
}, (table) => ({
	epoch_block_height_idx: index("epoch_block_height_idx").on(table.block_height),
	// epoch_block_date_idx: index("epoch_block_date_idx").on(table.block_date),
	epoch_elected_validators_idx: index("epoch_elected_validators_idx").on(table.elected_validators),
}));
export type Epoch = typeof epochs.$inferSelect;
export type EpochInsert = typeof epochs.$inferInsert;

export const epochsRelations = relations(epochs, ({ one }) => ({
	block: one(blocks, {
		fields: [epochs.block_height],
		references: [blocks.height],
	}),
}));

export const accounts = pgTable("accounts", {
	address: text("address").primaryKey(),
	type: integer("type").notNull(),
	balance: bigint("balance", { mode: "number" }).notNull(),
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

export const accountsRelations = relations(accounts, ({ many, one }) => ({
	sent_transactions: many(transactions, { relationName: "sender" }),
	received_transactions: many(transactions, { relationName: "recipient" }),
	blocks: many(blocks),
	first_seen_block: one(blocks, {
		fields: [accounts.first_seen],
		references: [blocks.height],
	}),
	last_sent_block: one(blocks, {
		fields: [accounts.last_sent],
		references: [blocks.height],
	}),
	last_received_block: one(blocks, {
		fields: [accounts.last_received],
		references: [blocks.height],
	}),
	vesting_contracts: many(vestingOwners, { relationName: "owner" }),
	vesting_owner: one(vestingOwners, {
		fields: [accounts.address],
		references: [vestingOwners.address],
		relationName: "contract",
	}),
}));

export const vestingOwners = pgTable("vesting_owners", {
	address: text("address").primaryKey().references(() => accounts.address, { onDelete: "cascade" }),
	owner: text("owner").notNull(),
}, (table) => ({
	address_idx: index("address_idx").on(table.address),
	owner_idx: index("owner_idx").on(table.owner),
}));
export type VestingOwner = typeof vestingOwners.$inferSelect;
export type VestingOwnerInsert = typeof vestingOwners.$inferInsert;

export const vestingOwnersRelations = relations(vestingOwners, ({ one }) => ({
	contract: one(accounts, {
		fields: [vestingOwners.address],
		references: [accounts.address],
	}),
	owner: one(accounts, {
		fields: [vestingOwners.owner],
		references: [accounts.address],
	}),
}));

export const transactions = pgTable("transactions", {
	hash: bytea("hash").primaryKey(),
	block_height: integer("block_height").references(() => blocks.height, { onDelete: "cascade" }),
	date: timestamp("timestamp_ms", { mode: "date", precision: 3 }),
	sender_address: text("sender_address").notNull(),
	sender_type: smallint("sender_type").notNull(),
	sender_data: bytea("sender_data"),
	recipient_address: text("recipient_address").notNull(),
	recipient_type: smallint("recipient_type").notNull(),
	recipient_data: bytea("recipient_data"),
	value: bigint("value", { mode: "number" }).notNull(),
	fee: bigint("fee", { mode: "number" }).notNull(),
	validity_start_height: integer("validity_start_height").notNull(),
	flags: smallint("flags").notNull(),
	proof: bytea("proof"),
	related_addresses: text("related_addresses").array().notNull(), // TODO: Go through PoW transactions and check for related addresses, e.g. signer !== sender
}, (table) => ({
	block_height_idx: index("block_height_idx").on(table.block_height),
	date_idx: index("date_idx").on(table.date),
	sender_address_idx: index("sender_address_idx").on(table.sender_address),
	recipient_address_idx: index("recipient_address_idx").on(table.recipient_address),
}));
export type Transaction = typeof transactions.$inferSelect;
export type TransactionInsert = typeof transactions.$inferInsert;

export const transactionsRelations = relations(transactions, ({ one }) => ({
	block: one(blocks, {
		fields: [transactions.block_height],
		references: [blocks.height],
	}),
	sender: one(accounts, {
		fields: [transactions.sender_address],
		references: [accounts.address],
		relationName: "sender",
	}),
	recipient: one(accounts, {
		fields: [transactions.recipient_address],
		references: [accounts.address],
		relationName: "recipient",
	}),
}));

/**
 * Staking
 */

export const inherents = pgTable("inherents", {
	id: bigserial("id", { mode: "bigint" }).primaryKey(),
	type: text("type").notNull(),
	block_height: integer("block_height").notNull().references(() => blocks.height, { onDelete: "cascade" }),
	date: timestamp("timestamp_ms", { mode: "date", precision: 3 }).notNull(),
	validator_address: text("validator_address").notNull(), // .references(() => validators.address, { onDelete: "cascade" })
	data: jsonb("data"),
}, (table) => ({
	inherent_type_idx: index("inherent_type_idx").on(table.type),
	inherent_block_height_idx: index("inherent_block_height_idx").on(table.block_height),
	// inherent_date_idx: index("inherent_date_idx").on(table.date),
	inherent_validator_address_idx: index("inherent_validator_address_idx").on(table.validator_address),
}));
export type Inherent = typeof inherents.$inferSelect;
export type InherentInsert = typeof inherents.$inferInsert;

export const inherentsRelations = relations(inherents, ({ one, many }) => ({
	block: one(blocks, {
		fields: [inherents.block_height],
		references: [blocks.height],
	}),
	validator: one(accounts, {
		fields: [inherents.validator_address],
		references: [accounts.address],
	}),
}));

/**
 * Prestaking
 */

export const validatorRegistrations = pgTable("validator_registrations", {
	address: text("address").primaryKey(),
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
export type ValidatorRegistration = typeof validatorRegistrations.$inferSelect;
export type ValidatorRegistrationInsert = typeof validatorRegistrations.$inferInsert;

export const validatorRegistrationsRelatations = relations(validatorRegistrations, ({ one, many }) => ({
	transaction_01: one(transactions, {
		fields: [validatorRegistrations.transaction_01],
		references: [transactions.hash],
	}),
	transaction_02: one(transactions, {
		fields: [validatorRegistrations.transaction_02],
		references: [transactions.hash],
	}),
	transaction_03: one(transactions, {
		fields: [validatorRegistrations.transaction_03],
		references: [transactions.hash],
	}),
	transaction_04: one(transactions, {
		fields: [validatorRegistrations.transaction_04],
		references: [transactions.hash],
	}),
	transaction_05: one(transactions, {
		fields: [validatorRegistrations.transaction_05],
		references: [transactions.hash],
	}),
	transaction_06: one(transactions, {
		fields: [validatorRegistrations.transaction_06],
		references: [transactions.hash],
	}),
	deposit_transaction: one(transactions, {
		fields: [validatorRegistrations.deposit_transaction],
		references: [transactions.hash],
	}),
	transaction_01_block: one(blocks, {
		fields: [validatorRegistrations.transaction_01_height],
		references: [blocks.height],
	}),
	deposit_transaction_block: one(blocks, {
		fields: [validatorRegistrations.deposit_transaction_height],
		references: [blocks.height],
	}),
	prestakers: many(prestakers),
}));

export const prestakers = pgTable("prestakers", {
	address: text("address").primaryKey(),
	delegation: text("delegation").notNull(),
	first_transaction_height: integer("first_transaction_height").notNull().references(() => blocks.height, {
		onDelete: "cascade",
	}),
	latest_transaction_height: integer("latest_transaction_height").references(() => blocks.height, {
		onDelete: "set null",
	}),
}, (table) => ({
	delegation_idx: index("delegation_idx").on(table.delegation),
	first_transaction_height_idx: index("first_transaction_height_idx").on(table.first_transaction_height),
	latest_transaction_height_idx: index("latest_transaction_height_idx").on(table.latest_transaction_height),
}));
export type Prestaker = typeof prestakers.$inferSelect;
export type PrestakerInsert = typeof prestakers.$inferInsert;

export const PrestakersRelatations = relations(prestakers, ({ one, many }) => ({
	delegation: one(validatorRegistrations, {
		fields: [prestakers.delegation],
		references: [validatorRegistrations.address],
	}),
	transactions: many(prestakingTransactions),
}));

export const prestakingTransactions = pgTable("prestaking_transactions", {
	transaction_hash: bytea("transaction_hash").notNull().unique().references(() => transactions.hash, {
		onDelete: "cascade",
	}),
	staker_address: text("staker_address").notNull().references(() => prestakers.address, {
		onDelete: "cascade",
	}),
	validator_stake_ratio: real("validator_stake_ratio").notNull(),
	is_underdog_pool: boolean("is_underdog_pool"),
}, (table) => ({
	staker_address_idx: index("staker_address_idx").on(table.staker_address),
}));
export type PrestakingTransaction = typeof prestakingTransactions.$inferSelect;
export type PrestakingTransactionInsert = typeof prestakingTransactions.$inferInsert;

export const prestakingTransactionsRelations = relations(prestakingTransactions, ({ one }) => ({
	staker: one(prestakers, {
		fields: [prestakingTransactions.staker_address],
		references: [prestakers.address],
	}),
	transaction: one(transactions, {
		fields: [prestakingTransactions.transaction_hash],
		references: [transactions.hash],
	}),
}));
