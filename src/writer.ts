import { Account, Address } from "@sisou/nimiq-ts";
import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
	type AccountInsert,
	accounts,
	type BlockInsert,
	blocks,
	type EpochInsert,
	epochs,
	type InherentInsert,
	inherents,
	type TransactionInsert,
	transactions,
	type VestingOwnerInsert,
	vestingOwners,
} from "../db/schema";
import { db } from "./database";
import { isMacroBlockAt } from "./lib/pos";
import {
	getAccount,
	getBlockByNumber,
	getInherentsByBlockNumber,
	getTransactionsByBlockNumber,
	Inherent,
	type Transaction,
} from "./pos/rpc";

function toTransactionInsert(tx: Transaction): TransactionInsert {
	return {
		date: tx.timestamp ? new Date(tx.timestamp) : undefined,
		hash: tx.hash,
		block_height: tx.blockNumber,
		sender_address: tx.from,
		sender_type: tx.fromType,
		sender_data: tx.senderData || null,
		recipient_address: tx.to,
		recipient_type: tx.toType,
		recipient_data: tx.recipientData || null,
		value: tx.value,
		fee: tx.fee,
		proof: tx.proof,
		flags: tx.flags,
		validity_start_height: tx.validityStartHeight,
		related_addresses: tx.relatedAddresses.filter(address => address !== tx.to && address !== tx.from),
	};
}

function toInherentInsert(inh: Inherent): InherentInsert {
	const { blockTime, blockNumber, type, validatorAddress, ...data } = inh;

	return {
		date: new Date(inh.blockTime),
		block_height: inh.blockNumber,
		type: inh.type,
		validator_address: inh.validatorAddress,
		data,
	};
}

export async function writeBlocks(
	fromBlock: number,
	toBlock: number,
	options?: Partial<{ forked: boolean; mempool: Set<string> }>,
) {
	let affectedAddresses = new Set<string>();
	if (options?.forked) {
		console.log(`Deleting blocks from #${fromBlock}`);
		// Fetch all accounts that will be affected
		affectedAddresses = new Set(
			await db.select({ address: accounts.address }).from(accounts).where(
				and(
					// Accounts with a first-seen height higher or equal to the from block will be deleted
					lt(accounts.first_seen, fromBlock),
					or(
						// The last_seen and last_received fields will be set to NULL by the deletion of the block
						gte(accounts.last_sent, fromBlock),
						gte(accounts.last_received, fromBlock),
					),
				),
			).then(res => res.map(row => row.address)),
		);

		// Through relational onDelete "cascade" rules, deleting a block deletes its epoch and all its transactions, inherents and first-seen accounts
		await db.delete(blocks).where(gte(blocks.height, fromBlock));
	}

	for (let i = fromBlock; i <= toBlock; i++) {
		// console.info(`Fetching block #${i}`);
		const isMacroBlock = isMacroBlockAt(i);
		const block = await getBlockByNumber(i, true);

		const blockTransactions = block?.transactions ?? await getTransactionsByBlockNumber(i);
		const blockInherents = await getInherentsByBlockNumber(i);

		const [value, fees] = blockTransactions.reduce(([value, fees], tx) => {
			value += tx.value;
			fees += tx.fee;
			return [value, fees];
		}, [0, 0]);

		const accountEntries = new Map<string, AccountInsert>();

		const blockEntry: BlockInsert = {
			height: i,
			date: block
				? new Date(block.timestamp)
				: blockTransactions[0]
				? new Date(blockTransactions[0].timestamp)
				: blockInherents[0]
				? new Date(blockInherents[0].blockTime)
				: undefined,
			hash: block?.hash,
			transaction_count: isMacroBlock ? 0 : blockTransactions.length,
			inherent_count: blockInherents.length,
			value,
			fees,
			size: block?.size,
			extra_data: block?.extraData || undefined,
		};

		// History nodes are guaranteed to have all election blocks
		const epochEntry: EpochInsert | undefined = block && block.type === "macro" && block.isElectionBlock
			? {
				number: block.epoch,
				block_height: i,
				elected_validators: block.slots.map((slot) => slot.validator),
				validator_slots: block.slots.map((slot) => slot.numSlots),
				// The transition (PoS genesis) doesn't have a justification
				votes: block.justification?.sig.signers.length ?? 512,
			}
			: undefined;

		const vestingOwnerEntries = new Map<string, VestingOwnerInsert>();

		const txEntries: TransactionInsert[] = isMacroBlock ? [] : blockTransactions.map((tx) => toTransactionInsert(tx));
		const inhEntries: InherentInsert[] = blockInherents.map((inherent) => toInherentInsert(inherent));

		for (const tx of blockTransactions) {
			accountEntries.set(tx.from, {
				address: tx.from,
				type: tx.fromType,
				balance: 0,
				first_seen: i,
				last_sent: i,
				last_received: undefined,
			});
			accountEntries.set(tx.to, {
				address: tx.to,
				type: tx.toType,
				balance: 0,
				first_seen: i,
				last_sent: undefined,
				last_received: i,
			});

			// Store vesting contract owners
			if (tx.toType === Account.Type.VESTING && tx.recipientData) {
				const owner = Address.fromHex(tx.recipientData.substring(0, 40)).toUserFriendlyAddress();
				vestingOwnerEntries.set(tx.to, {
					address: tx.to,
					owner,
				});
			}

			options?.mempool?.delete(tx.hash);
		}

		// Fetch balances
		await Promise.all(
			Array.from(accountEntries.keys()).map(async (address) => {
				const account = await getAccount(address);
				// biome-ignore lint/style/noNonNullAssertion: iteration is over keys of accountEntries
				accountEntries.get(address)!.balance = account.balance;
			}),
		);

		// Fill in the last_sent and last_received fields for affectedAddresses
		if (affectedAddresses.size) {
			await Promise.all(
				Array.from(affectedAddresses.values()).map(async (address) => {
					const entry: AccountInsert | undefined = accountEntries.get(address)
						|| await db.select().from(accounts).where(eq(accounts.address, address)).limit(1).then(res => res[0]);
					if (!entry) {
						console.error(`Fork-affected account ${address} not found!!!`);
						return;
					}
					if (!accountEntries.has(address)) {
						// Update balance for accounts that are not in the fork
						const account = await getAccount(address);
						accountEntries.set(address, {
							...entry,
							balance: account.balance,
						});
					}
					if (!entry.last_sent) {
						const lastSent = await db.select({ block_height: transactions.block_height }).from(transactions).where(
							eq(transactions.sender_address, entry.address),
						).orderBy(desc(transactions.block_height)).limit(1).then(res => res.at(0)?.block_height);

						// biome-ignore lint/style/noNonNullAssertion: an account entry was either found or created above
						accountEntries.get(entry.address)!.last_sent = lastSent;
					}
					if (!entry.last_received) {
						const [lastReceived, lastMined] = await Promise.all([
							db.select({ block_height: transactions.block_height }).from(transactions).where(
								eq(transactions.recipient_address, entry.address),
							).orderBy(desc(transactions.block_height)).limit(1).then(res => res.at(0)?.block_height),
							db.select({ height: blocks.height }).from(blocks).where(eq(blocks.creator_address, address)).orderBy(
								desc(blocks.height),
							).limit(1).then(res => res.at(0)?.height),
						]);

						const laterOfTheTwo = Math.max(lastReceived || 0, lastMined || 0);

						// biome-ignore lint/style/noNonNullAssertion: an account entry was either found or created above
						accountEntries.get(entry.address)!.last_received = laterOfTheTwo > 0 ? laterOfTheTwo : undefined;
					}
					// Delete address from affectedAddresses so that it is not processed again
					affectedAddresses.delete(address);
				}),
			);
		}

		console.log(
			`For block #${i}, generated 1 block, ${txEntries.length} transactions, ${accountEntries.size} accounts`,
		);

		await db.transaction(async (trx) => {
			await trx.insert(blocks).values(blockEntry);
			if (epochEntry) await trx.insert(epochs).values(epochEntry);

			if (accountEntries.size) {
				// Accounts must be entered after blocks, so that new blocks are already in the database
				const tableName = getTableConfig(accounts).name;
				await trx.insert(accounts)
					.values([...accountEntries.values()])
					.onConflictDoUpdate({
						target: accounts.address,
						set: {
							type: sql.raw(`COALESCE(EXCLUDED.${accounts.type.name}, ${tableName}.${accounts.type.name})`),
							balance: sql.raw(`COALESCE(EXCLUDED.${accounts.balance.name}, ${tableName}.${accounts.balance.name})`),
							last_sent: sql.raw(
								`COALESCE(EXCLUDED.${accounts.last_sent.name}, ${tableName}.${accounts.last_sent.name})`,
							),
							last_received: sql.raw(
								`COALESCE(EXCLUDED.${accounts.last_received.name}, ${tableName}.${accounts.last_received.name})`,
							),
						},
					});
			}

			if (vestingOwnerEntries.size) {
				const tableName = getTableConfig(vestingOwners).name;
				await trx.insert(vestingOwners)
					.values([...vestingOwnerEntries.values()])
					.onConflictDoUpdate({
						target: vestingOwners.address,
						set: {
							owner: sql.raw(
								`COALESCE(EXCLUDED.${vestingOwners.owner.name}, ${tableName}.${vestingOwners.owner.name})`,
							),
						},
					});
			}

			if (txEntries.length) {
				const tableName = getTableConfig(transactions).name;
				await trx.insert(transactions).values(txEntries).onConflictDoUpdate({
					target: transactions.hash,
					set: {
						block_height: sql.raw(
							`COALESCE(EXCLUDED.${transactions.block_height.name}, ${tableName}.${transactions.block_height.name})`,
						),
						date: sql.raw(`COALESCE(EXCLUDED.${transactions.date.name}, ${tableName}.${transactions.date.name})`),
						proof: sql.raw(`COALESCE(EXCLUDED.${transactions.proof.name}, ${tableName}.${transactions.proof.name})`),
					},
				});
			}

			if (inhEntries.length) {
				await trx.insert(inherents).values(inhEntries);
				// Inherents don't have an identifier, so they cannot conflict.
			}
		});
	}
}

export async function writeMempoolTransactions(txs: Transaction[]) {
	if (!txs.length) return;
	const txEntries = txs.map((tx) => toTransactionInsert(tx));
	await db.insert(transactions).values(txEntries).onConflictDoNothing();
}
