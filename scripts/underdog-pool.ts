/**
 * This script goes through all prestaking_transactions that have a higher validator_stake_ratio than 0.1 and checks
 * if the validator that was staked with is a pool and if that pool was the smallest pool at the time,
 * in which case the transactions qualifies as an underdog transaction.
 */

import { ValidationUtils } from "@nimiq/utils";
import { and, desc, gte, isNotNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { db, pg } from "../src/database";
import { getPoolAddressesAtBlockHeight } from "../src/lib/prestaking";

const prestakingTransactions = await db.query.prestakingTransactions.findMany({
	columns: {
		is_underdog_pool: true,
	},
	where: and(
		gte(schema.prestakingTransactions.validator_stake_ratio, 0.1),
	),
	with: {
		transaction: {
			columns: {
				hash: true,
				block_height: true,
				date: true,
				recipient_data: true,
			},
		},
	},
});

let cache: {
	validators: {
		address: string;
		deposit_transaction: {
			value: number;
		} | null;
		prestakers: {
			transactions: {
				transaction: {
					value: number;
					block_height: number | null;
				};
			}[];
		}[];
	}[];
	chainHeight: number;
} | undefined;

let count = 0;
for (const tx of prestakingTransactions) {
	count += 1;
	// if (count % 100 === 0) {
	// 	console.log("At tx nr.", count, "/", prestakingTransactions.length);
	// }

	const transaction = tx.transaction;
	if (!transaction || !transaction.block_height) continue;

	const dataDecoded = new TextDecoder("utf-8", { fatal: true }).decode(
		new Uint8Array(Buffer.from(transaction.recipient_data!, "hex")),
	);
	const validatorAddress = ValidationUtils.normalizeAddress(dataDecoded);

	const poolIsUnderdogNow = await isUnderdogPoolAtBlockHeight(validatorAddress, transaction.block_height - 1);
	const poolWasUnderdogBefore = await isUnderdogPoolAtBlockHeight(validatorAddress, transaction.block_height - 2);

	const poolIsUnderdog = poolIsUnderdogNow || poolWasUnderdogBefore;

	if (poolIsUnderdog !== tx.is_underdog_pool) {
		// await db
		// 	.update(schema.prestakingTransactions)
		// 	.set({ is_underdog_pool: poolIsUnderdog })
		// 	.where(eq(schema.prestakingTransactions.transaction_hash, transaction.hash));
		console.log(
			"Updated transaction",
			transaction.date, // res[0].hash,
			poolIsUnderdog,
		);
	}
}

console.log("Processed", count, "pre-staking transactions");

await pg.end({ timeout: 5 });

async function getStakingContract() {
	console.log("Fetching staking contract data");

	const headBlock = await db.query.blocks.findFirst({
		columns: {
			height: true,
		},
		orderBy: desc(schema.blocks.height),
	});
	if (!headBlock) {
		throw new Error("No blocks found in database");
	}

	const validators = await db.query.validatorRegistrations.findMany({
		where: and(
			isNotNull(schema.validatorRegistrations.transaction_01),
			isNotNull(schema.validatorRegistrations.transaction_02),
			isNotNull(schema.validatorRegistrations.transaction_03),
			isNotNull(schema.validatorRegistrations.transaction_04),
			isNotNull(schema.validatorRegistrations.transaction_05),
			isNotNull(schema.validatorRegistrations.transaction_06),
			isNotNull(schema.validatorRegistrations.deposit_transaction),
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
									block_height: true,
									value: true,
									date: true,
								},
							},
						},
					},
				},
			},
		},
	});

	for (const { prestakers } of validators) {
		for (const { transactions } of prestakers) {
			transactions.sort((a, b) => (a.transaction.block_height || Infinity) - (b.transaction.block_height || Infinity));
		}
	}

	return {
		validators,
		chainHeight: headBlock.height,
	};
}

async function getStakingContractAtBlockHeight(height: number) {
	cache = cache && height <= cache.chainHeight
		? cache
		: await getStakingContract();

	const validatorStakes = cache.validators.map(({ address, deposit_transaction, prestakers }) => {
		let deposit = deposit_transaction!.value;
		// Do not count extra stake in deposit transaction that is below the minimum stake of 100 NIM
		if (deposit < 100_100e5) {
			deposit = 100_000e5;
		}
		const prestake = prestakers.reduce((total, { transactions }) => {
			let hadValidTransaction = false;
			return total + transactions.reduce((total, { transaction }) => {
				if (!transaction.block_height || transaction.block_height > height) return total;
				hadValidTransaction = hadValidTransaction || transaction.value >= 100e5;
				return total + (hadValidTransaction ? transaction.value : 0);
			}, 0);
		}, 0);

		return {
			address,
			deposit,
			delegatedStake: prestake,
		};
	}, 0);

	return {
		validators: validatorStakes,
		totalStake: validatorStakes.reduce(
			(total, { deposit, delegatedStake }) => total + deposit + delegatedStake,
			0,
		),
	};
}

async function isUnderdogPoolAtBlockHeight(address: string, height: number) {
	const stakingContract = await getStakingContractAtBlockHeight(height);
	const poolAddresses = getPoolAddressesAtBlockHeight(height);

	const pools = stakingContract.validators
		.filter(({ address }) => poolAddresses.includes(address))
		.sort((a, b) => (a.deposit + a.delegatedStake) - (b.deposit + b.delegatedStake));

	return pools[0].address === address;
}
