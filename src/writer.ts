import { Account, Address } from "@sisou/nimiq-ts";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
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
import { isMacroBlockAt, isMainnet } from "./lib/pos";
import {
	getAccount,
	getBlockByNumber,
	getInherentsByBlockNumber,
	getTransactionsByBlockNumber,
	type Inherent,
	type Transaction,
} from "./pos/rpc";

/**
 * `executed` is passed in explicitly rather than read off `tx`, because mempool transactions share this shape but
 * have no execution result yet. Omitting it falls back to the column default (`true`), which the block write corrects.
 */
function toTransactionInsert(tx: Transaction, executed?: boolean): TransactionInsert {
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
		related_addresses: tx.relatedAddresses?.filter(address => address !== tx.to && address !== tx.from) || [],
		executed,
	};
}

function toInherentInsert(inh: Inherent): InherentInsert {
	const { blockTime, blockNumber, type, validatorAddress, target, ...data } = inh;

	return {
		date: new Date(blockTime),
		block_height: blockNumber,
		type: type,
		validator_address: validatorAddress,
		target_address: target,
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
			creator_address: block && "producer" in block ? block.producer.validator : undefined,
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

		if (epochEntry) {
			console.log(`Storing EPOCH ${epochEntry.number}`);
		}

		const vestingOwnerEntries = new Map<string, VestingOwnerInsert>();

		const txEntries: TransactionInsert[] = isMacroBlock
			? []
			: blockTransactions
				.filter((tx) => isMainnet || tx.value >= 10)
				.map((tx) => toTransactionInsert(tx, tx.executionResult));
		const inhEntries: InherentInsert[] = blockInherents.map((inherent) => toInherentInsert(inherent));

		for (const tx of blockTransactions) {
			// Merge into any existing entry, so that an address touched as both sender and recipient within the same
			// block does not have one side's last_sent/last_received overwritten with undefined by the other.
			const senderEntry = accountEntries.get(tx.from);
			accountEntries.set(tx.from, {
				address: tx.from,
				type: tx.fromType,
				balance: 0,
				first_seen: senderEntry?.first_seen ?? i,
				last_sent: i,
				last_received: senderEntry?.last_received,
			});

			// A failed transaction only deducts the fee from the sender. The recipient is left untouched, and the
			// recipient type claimed by the transaction was never validated, so writing it would clobber the real
			// account type (e.g. downgrading an HTLC to BASIC). Skip the recipient entirely.
			if (tx.executionResult) {
				const recipientEntry = accountEntries.get(tx.to);
				accountEntries.set(tx.to, {
					address: tx.to,
					type: tx.toType,
					balance: 0,
					first_seen: recipientEntry?.first_seen ?? i,
					last_sent: recipientEntry?.last_sent,
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
								and(
									eq(transactions.recipient_address, entry.address),
									// A failed transaction never credited the recipient
									eq(transactions.executed, true),
								),
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
			`For block #${i}, generated 1 block, ${txEntries.length} transactions, ${accountEntries.size} accounts, ${inhEntries.length} inherents`,
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
						// Deliberately not COALESCEd: a `false` from the block must overwrite the `true` that the
						// mempool row defaulted to.
						executed: sql.raw(`EXCLUDED.${transactions.executed.name}`),
					},
				});
			}

			if (inhEntries.length) {
				await trx.insert(inherents).values(inhEntries);
				// Inherents don't have an identifier, so they cannot conflict.
			}
		});

		// await extractRewardInherentTargetAddress();
	}
}

export async function writeMempoolTransactions(txs: Transaction[]) {
	if (!txs.length) return;
	const txEntries = txs.map((tx) => toTransactionInsert(tx));
	await db.insert(transactions).values(txEntries).onConflictDoNothing();
}

async function extractRewardInherentTargetAddress() {
	// const count = await db.$count(
	// 	inherents,
	// 	and(
	// 		eq(inherents.type, "reward"),
	// 		isNull(inherents.target_address),
	// 	),
	// );

	// console.log(`Found ${count} reward inherents without target_address set`);

	// let progress = 0;

	const dbInherents = await db.query.inherents.findMany({
		where: and(
			eq(inherents.type, "reward"),
			isNull(inherents.target_address),
		),
		limit: 100,
		columns: {
			id: true,
			data: true,
		},
	});

	for (const inh of dbInherents) {
		const data = inh.data as { target?: string };
		const target_address = data.target;
		delete data.target;

		await db.update(inherents)
			.set({
				target_address: target_address,
				data: data,
			})
			.where(eq(inherents.id, inh.id));
	}

	// progress += dbInherents.length;

	// console.log(
	// 	`Processed batch of ${dbInherents.length} inherents (${progress}/${count}, ${
	// 		((progress / count) * 100).toFixed(2)
	// 	}%)`,
	// );

	console.log(`Processed ${dbInherents.length} reward inherents`);
}
