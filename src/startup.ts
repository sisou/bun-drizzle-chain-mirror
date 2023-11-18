import { AccountInsert, accounts, BlockInsert, blocks, TransactionInsert, transactions } from "../db/schema";
import { db } from "./database";
import { getAccount, getBlockByNumber } from "./rpc";

export async function writeBlocks(fromBlock: number, toBlock: number) {
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
			timestamp_ms: new Date(block.timestamp * 1e3),
			hash: Buffer.from(block.hash, "hex"),
			creator_address: block.minerAddress,
			transaction_count: block.transactions.length,
			value,
			fees,
			size: block.size,
			difficulty: block.difficulty,
			extra_data: Buffer.from(block.extraData, "hex"),
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
				hash: Buffer.from(tx.hash, "hex"),
				block_height: block.number,
				sender_address: tx.fromAddress,
				sender_type: tx.fromType,
				sender_data: undefined,
				recipient_address: tx.toAddress,
				recipient_type: tx.toType,
				recipient_data: tx.data ? Buffer.from(tx.data, "hex") : null,
				value: tx.value,
				fee: tx.fee,
				proof: tx.proof ? Buffer.from(tx.proof, "hex") : null,
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
				creation_data: tx.toType !== 0 ? Buffer.from(tx.data!, "hex") : undefined,
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
				accountEntries.get(address)!.balance = account.balance;
			}),
		);

		console.log(
			`For block #${i}, generated 1 block, ${txEntries.length} transactions, ${accountEntries.size} accounts`,
		);

		await db.transaction(async (trx) => {
			await trx.insert(blocks).values(blockEntry);

			if (txEntries.length) await trx.insert(transactions).values(txEntries);

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
		});
	}
}
