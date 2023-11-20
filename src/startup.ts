import { and, desc, eq, gte, lt, or } from "drizzle-orm";
import { AccountInsert, accounts, BlockInsert, blocks, TransactionInsert, transactions } from "../db/schema";
import { db } from "./database";
import { getAccount, getBlockByNumber } from "./rpc";

export async function writeBlocks(fromBlock: number, toBlock: number, overwrite = false) {
	let affectedAddresses = new Set<string>();
	if (overwrite) {
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

		// Through relational onDelete "cascade" rules, deleting the block deletes all its transactions and first-seen accounts
		await db.delete(blocks).where(gte(blocks.height, fromBlock));
	}

	for (let i = fromBlock; i <= toBlock; i++) {
		// console.info(`Fetching block #${i}`);
		const block = await getBlockByNumber(i, true);

		const [value, fees] = block.transactions.reduce(([value, fees], tx) => {
			value += tx.value;
			fees += tx.fee;
			return [value, fees];
		}, [0, 0]);

		const accountEntries = new Map<string, AccountInsert>();

		const blockEntry: BlockInsert = {
			height: block.number,
			date: new Date(block.timestamp * 1e3),
			hash: block.hash,
			creator_address: block.minerAddress,
			transaction_count: block.transactions.length,
			value,
			fees,
			size: block.size,
			difficulty: block.difficulty,
			extra_data: block.extraData,
		};
		accountEntries.set(block.minerAddress, {
			address: block.minerAddress,
			type: 0,
			balance: 0,
			creation_data: undefined,
			first_seen: block.number,
			last_sent: undefined,
			last_received: block.number,
		});

		const txEntries = block.transactions.map((tx) => {
			const txEntry: TransactionInsert = {
				timestamp_ms: new Date(tx.timestamp * 1e3),
				hash: tx.hash,
				block_height: block.number,
				sender_address: tx.fromAddress,
				sender_type: tx.fromType,
				sender_data: undefined,
				recipient_address: tx.toAddress,
				recipient_type: tx.toType,
				recipient_data: tx.data,
				value: tx.value,
				fee: tx.fee,
				proof: tx.proof,
				flags: tx.flags,
				validity_start_height: tx.validityStartHeight,
			};
			accountEntries.set(tx.fromAddress, {
				address: tx.fromAddress,
				type: tx.fromType,
				balance: 0,
				creation_data: undefined,
				first_seen: block.number,
				last_sent: block.number,
				last_received: tx.fromAddress === block.minerAddress ? block.number : undefined,
			});
			accountEntries.set(tx.toAddress, {
				address: tx.toAddress,
				type: tx.toType,
				balance: 0,
				creation_data: tx.toType !== 0 ? tx.data : undefined,
				first_seen: block.number,
				last_sent: undefined,
				last_received: block.number,
			});
			return txEntry;
		});

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
					const entry = accountEntries.get(address)
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

			// Accounts must be entered before transactions, so that new recipients are already in the database
			await Promise.all(
				Array.from(accountEntries.values())
					.map((account) =>
						trx.insert(accounts)
							.values(account)
							.onConflictDoUpdate({
								target: accounts.address,
								set: {
									type: account.type,
									balance: account.balance,
									creation_data: account.creation_data,
									last_sent: account.last_sent,
									last_received: account.last_received,
								},
							})
					),
			);

			// Transactions must be entered after accounts, so that new recipients are already in the database
			if (txEntries.length) await trx.insert(transactions).values(txEntries);
		});
	}
}
