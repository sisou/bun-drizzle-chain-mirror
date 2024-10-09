import { ValidationUtils } from "@nimiq/utils";
import { Account, Address } from "@sisou/nimiq-ts";
import { and, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
	type AccountInsert,
	accounts,
	type BlockInsert,
	blocks,
	type PrestakerInsert,
	prestakers,
	type PrestakingTransactionInsert,
	prestakingTransactions,
	type TransactionInsert,
	transactions,
	type ValidatorRegistrationInsert,
	validatorRegistrations,
	type VestingOwnerInsert,
	vestingOwners,
} from "../db/schema";
import { db } from "./database";
import {
	BURN_ADDRESS,
	MIN_DELEGATION,
	PRESTAKING_END_HEIGHT,
	PRESTAKING_START_HEIGHT,
	REGISTRATION_END_HEIGHT,
	REGISTRATION_START_HEIGHT,
	VALIDATOR_DEPOSIT,
} from "./lib/prestaking";
import { getAccount, getBlockByNumber, type Transaction } from "./rpc";

function toTransactionInsert(tx: Transaction, blockNumber?: number): TransactionInsert {
	return {
		date: tx.timestamp ? new Date(tx.timestamp * 1e3) : undefined,
		hash: tx.hash,
		block_height: blockNumber,
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
			first_seen: block.number,
			last_sent: undefined,
			last_received: block.number,
		});

		const vestingOwnerEntries = new Map<string, VestingOwnerInsert>();
		const validatorRegistrationEntries = new Map<string, ValidatorRegistrationInsert>();
		const prestakerEntries = new Map<string, PrestakerInsert>();
		const prestakingTransactionEntries: PrestakingTransactionInsert[] = [];

		const txEntries = block.transactions.map((tx) => toTransactionInsert(tx, block.number));

		let stakingContract: {
			validators: {
				address: String;
				deposit: number;
				delegatedStake: number;
			}[];
			totalStake: number;
		} | undefined;

		async function getStakingContract() {
			if (!stakingContract) {
				const validators = await db.query.validatorRegistrations.findMany({
					where: and(
						isNotNull(validatorRegistrations.transaction_01),
						isNotNull(validatorRegistrations.transaction_02),
						isNotNull(validatorRegistrations.transaction_03),
						isNotNull(validatorRegistrations.transaction_04),
						isNotNull(validatorRegistrations.transaction_05),
						isNotNull(validatorRegistrations.transaction_06),
						isNotNull(validatorRegistrations.deposit_transaction),
					),
					columns: {
						address: true,
					},
					with: {
						deposit_transaction: {
							columns: {
								value: true,
							},
						},
						prestakers: {
							columns: {},
							with: {
								transactions: {
									columns: {},
									with: {
										transaction: {
											columns: {
												value: true,
											},
										},
									},
								},
							},
						},
					},
				});

				const validatorStakes = validators.map((validator) => {
					let deposit = validator.deposit_transaction!.value;
					// Do not count extra stake in deposit transaction that is below the minimum stake of 100 NIM
					if (deposit < 100_100e5) {
						deposit = 100_000e5;
					}
					const prestake = validator.prestakers.reduce((total, prestaker) => {
						const prestake = prestaker.transactions.reduce((total, transaction) => {
							return total + (transaction.transaction.value >= 100e5 ? transaction.transaction.value : 0);
						}, 0);
						return total + prestake;
					}, 0);

					return {
						address: validator.address,
						deposit,
						delegatedStake: prestake,
					};
				}, 0);

				stakingContract = {
					validators: validatorStakes,
					totalStake: validatorStakes.reduce(
						(total, { deposit, delegatedStake }) => total + deposit + delegatedStake,
						0,
					),
				};
			}
			return stakingContract;
		}

		for (const tx of block.transactions) {
			accountEntries.set(tx.fromAddress, {
				address: tx.fromAddress,
				type: tx.fromType,
				balance: 0,
				first_seen: block.number,
				last_sent: block.number,
				last_received: tx.fromAddress === block.minerAddress ? block.number : undefined,
			});
			accountEntries.set(tx.toAddress, {
				address: tx.toAddress,
				type: tx.toType,
				balance: 0,
				first_seen: block.number,
				last_sent: undefined,
				last_received: block.number,
			});

			// Store vesting contract owners
			if (tx.toType === Account.Type.VESTING && tx.data) {
				const owner = Address.fromHex(tx.data.substring(0, 40)).toUserFriendlyAddress();
				vestingOwnerEntries.set(tx.toAddress, {
					address: tx.toAddress,
					owner,
				});
			}

			if (
				block.number >= REGISTRATION_START_HEIGHT && block.number < REGISTRATION_END_HEIGHT
				&& tx.toAddress === BURN_ADDRESS
			) {
				if (
					tx.data?.length === 128
					&& (tx.data.substring(0, 24) === "010000000000000000000000" || [
						"02000000000000",
						"03000000000000",
						"04000000000000",
						"05000000000000",
						"06000000000000",
					].includes(tx.data.substring(0, 14)))
				) {
					// Handle validator pre-registration transaction
					const validatorAddress = tx.fromAddress;
					const registration = validatorRegistrationEntries.get(validatorAddress);
					validatorRegistrationEntries.set(validatorAddress, {
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
						const registration = validatorRegistrationEntries.get(validatorAddress);
						validatorRegistrationEntries.set(validatorAddress, {
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
				block.number >= PRESTAKING_START_HEIGHT && block.number < PRESTAKING_END_HEIGHT
				&& tx.toAddress === BURN_ADDRESS
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

						// If transaction value is below MIN_DELEGATION, the transaction is only valid for prestaking
						// when the staker already exists.
						if (
							tx.value >= MIN_DELEGATION || await db.query.prestakers.findFirst({
								where: eq(prestakers.address, stakerAddress),
								columns: {
									address: true,
								},
							})
						) {
							const staker = prestakerEntries.get(stakerAddress);
							prestakerEntries.set(stakerAddress, {
								address: stakerAddress,
								delegation: validatorAddress,
								first_transaction_height: staker?.first_transaction_height || block.number,
								latest_transaction_height: block.number,
							});

							const stakingContract = await getStakingContract();
							const validator = stakingContract.validators.find(validator => validator.address === validatorAddress)
								|| { address: validatorAddress, deposit: 0, delegatedStake: 0 };

							prestakingTransactionEntries.push({
								transaction_hash: tx.hash,
								staker_address: stakerAddress,
								validator_stake_ratio: (validator.deposit + validator.delegatedStake) / stakingContract.totalStake,
							});
						}
					}
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

		if (validatorRegistrationEntries.size) {
			console.log(`For block #${i}, generated ${validatorRegistrationEntries.size} validator preregistrations`);
		}

		if (prestakerEntries.size) {
			console.log(
				`For block #${i}, generated ${prestakerEntries.size} prestaking stakers with ${prestakingTransactionEntries.length} transactions`,
			);
		}

		await db.transaction(async (trx) => {
			await trx.insert(blocks).values(blockEntry);

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

			if (validatorRegistrationEntries.size) {
				// Validator preregistrations must be entered after transactions, so that registration transactions are already in the database
				const tableName = getTableConfig(validatorRegistrations).name;
				await trx.insert(validatorRegistrations)
					.values([...validatorRegistrationEntries.values()])
					.onConflictDoUpdate({
						target: validatorRegistrations.address,
						set: {
							transaction_01: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.transaction_01.name}, ${tableName}.${validatorRegistrations.transaction_01.name})`,
							),
							transaction_02: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.transaction_02.name}, ${tableName}.${validatorRegistrations.transaction_02.name})`,
							),
							transaction_03: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.transaction_03.name}, ${tableName}.${validatorRegistrations.transaction_03.name})`,
							),
							transaction_04: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.transaction_04.name}, ${tableName}.${validatorRegistrations.transaction_04.name})`,
							),
							transaction_05: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.transaction_05.name}, ${tableName}.${validatorRegistrations.transaction_05.name})`,
							),
							transaction_06: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.transaction_06.name}, ${tableName}.${validatorRegistrations.transaction_06.name})`,
							),
							deposit_transaction: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.deposit_transaction.name}, ${tableName}.${validatorRegistrations.deposit_transaction.name})`,
							),
							transaction_01_height: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.transaction_01_height.name}, ${tableName}.${validatorRegistrations.transaction_01_height.name})`,
							),
							deposit_transaction_height: sql.raw(
								`COALESCE(EXCLUDED.${validatorRegistrations.deposit_transaction_height.name}, ${tableName}.${validatorRegistrations.deposit_transaction_height.name})`,
							),
						},
					});
			}

			if (prestakerEntries.size) {
				const tableName = getTableConfig(prestakers).name;
				await trx.insert(prestakers)
					.values([...prestakerEntries.values()])
					.onConflictDoUpdate({
						target: prestakers.address,
						set: {
							delegation: sql.raw(
								`COALESCE(EXCLUDED.${prestakers.delegation.name}, ${tableName}.${prestakers.delegation.name})`,
							),
							latest_transaction_height: sql.raw(
								`COALESCE(EXCLUDED.${prestakers.latest_transaction_height.name}, ${tableName}.${prestakers.latest_transaction_height.name})`,
							),
						},
					});
			}

			if (prestakingTransactionEntries.length) {
				await trx.insert(prestakingTransactions).values(prestakingTransactionEntries);
			}
		});
	}
}

export async function writeMempoolTransactions(txs: Transaction[]) {
	if (!txs.length) return;
	const txEntries = txs.map((tx) => toTransactionInsert(tx));
	await db.insert(transactions).values(txEntries).onConflictDoNothing();
}
