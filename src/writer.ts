import { ValidationUtils } from "@nimiq/utils";
import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import {
	AccountInsert,
	accounts,
	BlockInsert,
	blocks,
	PrestakingStakerInsert,
	prestakingStakers,
	TransactionInsert,
	transactions,
	ValidatorPreregistrationInsert,
	validatorPreregistrations,
} from "../db/schema";
import { db } from "./database";
import {
	PRESTAKING_END_HEIGHT,
	PRESTAKING_START_HEIGHT,
	REGISTRATION_END_HEIGHT,
	REGISTRATION_START_HEIGHT,
	VALIDATOR_DEPOSIT,
} from "./lib/prestaking";
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

		const validatorPreregistrationEntries = new Map<string, ValidatorPreregistrationInsert>();
		const prestakerStakerEntries = new Map<string, PrestakingStakerInsert>();

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

			if (
				block.number >= REGISTRATION_START_HEIGHT && block.number <= REGISTRATION_END_HEIGHT
				&& tx.toAddress === "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"
			) {
				if (tx.data?.length === 128
					&& (tx.data.substring(0, 24) === '010000000000000000000000' || [
						"02000000000000",
						"03000000000000",
						"04000000000000",
						"05000000000000",
						"06000000000000",
					].includes(tx.data.substring(0, 14)))
				) {
					// Handle validator pre-registration transaction
					const validatorAddress = tx.fromAddress;
					const registration = validatorPreregistrationEntries.get(validatorAddress);
					validatorPreregistrationEntries.set(validatorAddress, {
						address: validatorAddress,
						transaction_01: tx.data.substring(0, 2) === "01" ? tx.hash : registration?.transaction_01,
						transaction_02: tx.data.substring(0, 2) === "02" ? tx.hash : registration?.transaction_02,
						transaction_03: tx.data.substring(0, 2) === "03" ? tx.hash : registration?.transaction_03,
						transaction_04: tx.data.substring(0, 2) === "04" ? tx.hash : registration?.transaction_04,
						transaction_05: tx.data.substring(0, 2) === "05" ? tx.hash : registration?.transaction_05,
						transaction_06: tx.data.substring(0, 2) === "06" ? tx.hash : registration?.transaction_06,
						deposit_transaction: registration?.deposit_transaction,
						transaction_01_height: tx.data.substring(0, 2) === "01"
							? block.number
							: registration?.transaction_01_height,
						deposit_transaction_height: registration?.deposit_transaction_height,
					});
				} else if (tx.data && tx.data.length >= 72 && tx.value >= VALIDATOR_DEPOSIT) {
					// Try decoding data as utf-8 and check if it is a valid human-readable address
					let dataDecoded: string | undefined;
					try {
						dataDecoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(tx.data, "hex"));
					} catch (e) {}
					if (dataDecoded && ValidationUtils.isValidAddress(dataDecoded)) {
						// Handle validator deposit transaction
						const validatorAddress = ValidationUtils.normalizeAddress(dataDecoded);
						const registration = validatorPreregistrationEntries.get(validatorAddress);
						validatorPreregistrationEntries.set(validatorAddress, {
							address: validatorAddress,
							transaction_01: registration?.transaction_01,
							transaction_02: registration?.transaction_02,
							transaction_03: registration?.transaction_03,
							transaction_04: registration?.transaction_04,
							transaction_05: registration?.transaction_05,
							transaction_06: registration?.transaction_06,
							deposit_transaction: tx.hash,
							transaction_01_height: registration?.transaction_01_height,
							deposit_transaction_height: block.number,
						});
					}
				}
			}

			if (
				block.number >= PRESTAKING_START_HEIGHT && block.number <= PRESTAKING_END_HEIGHT
				&& tx.toAddress === "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"
			) {
				if (tx.data && tx.data.length >= 72) {
					// Try decoding data as utf-8 and check if it is a valid human-readable address
					let dataDecoded: string | undefined;
					try {
						dataDecoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(tx.data, "hex"));
					} catch (e) {}
					if (dataDecoded && ValidationUtils.isValidAddress(dataDecoded)) {
						const stakerAddress = tx.fromAddress;
						const validatorAddress = ValidationUtils.normalizeAddress(dataDecoded);
						const staker = prestakerStakerEntries.get(stakerAddress);
						prestakerStakerEntries.set(stakerAddress, {
							address: stakerAddress,
							delegation: validatorAddress,
							transactions: staker?.transactions.concat(tx.hash) || [tx.hash],
							first_transaction_height: staker?.first_transaction_height || block.number,
							latest_transaction_height: block.number,
						});
					}
				}
			}

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

		if (validatorPreregistrationEntries.size) {
			console.log(`For block #${i}, generated ${validatorPreregistrationEntries.size} validator preregistrations`);
		}

		if (prestakerStakerEntries.size) {
			console.log(`For block #${i}, generated ${prestakerStakerEntries.size} prestaking stakers`);
		}

		await db.transaction(async (trx) => {
			await trx.insert(blocks).values(blockEntry);

			// Accounts must be entered after blocks, so that new blocks are already in the database
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

			// Validator preregistrations must be entered after transactions, so that registration transactions are already in the database
			await Promise.all(
				Array.from(validatorPreregistrationEntries.values())
					.map((registration) =>
						trx.insert(validatorPreregistrations)
							.values(registration)
							.onConflictDoUpdate({
								target: validatorPreregistrations.address,
								set: {
									transaction_01: registration.transaction_01,
									transaction_02: registration.transaction_02,
									transaction_03: registration.transaction_03,
									transaction_04: registration.transaction_04,
									transaction_05: registration.transaction_05,
									transaction_06: registration.transaction_06,
									deposit_transaction: registration.deposit_transaction,
									transaction_01_height: registration.transaction_01_height,
									deposit_transaction_height: registration.deposit_transaction_height,
								},
							})
					),
			);

			await Promise.all(
				Array.from(prestakerStakerEntries.values())
					.map((staker) =>
						trx.insert(prestakingStakers)
							.values({
								...staker,
								transactions: sql.raw(`ARRAY[${staker.transactions.map(hash => `'\\x${hash}'`).join(", ")}]::bytea[]`),
							})
							.onConflictDoUpdate({
								target: prestakingStakers.address,
								set: {
									delegation: staker.delegation,
									transactions: sql`ARRAY_CAT(${prestakingStakers.transactions}, ${
										sql.raw(`ARRAY[${staker.transactions.map(hash => `'\\x${hash}'`).join(", ")}]::bytea[]`)
									})`,
									latest_transaction_height: staker.latest_transaction_height,
								},
							})
					),
			);
		});
	}
}
