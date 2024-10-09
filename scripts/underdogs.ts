/**
 * This script goes through all prestaking_transactions and calculates the minimum validatorStakeRatio between the
 * staking contract data at the last and second-last block before the transaction.
 * It then updates the database with the new value.
 */

import { ValidationUtils } from "@nimiq/utils";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { db } from "../src/database";

const prestakingTransactions = await db.query.prestakingTransactions.findMany({
	with: {
		transaction: true,
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
	if (count % 100 === 0) {
		console.log("At tx nr.", count);
	}

	const transaction = tx.transaction;
	if (!transaction || !transaction.block_height) continue;

	const dataDecoded = new TextDecoder("utf-8", { fatal: true }).decode(
		new Uint8Array(Buffer.from(transaction.recipient_data!, "hex")),
	);
	const validatorAddress = ValidationUtils.normalizeAddress(dataDecoded);

	const stakingContractNow = await getStakingContractAtBlockHeight(transaction.block_height - 1);
	const stakingContractBefore = await getStakingContractAtBlockHeight(transaction.block_height - 2);

	const validatorNow = stakingContractNow.validators.find(validator => validator.address === validatorAddress)
		|| { address: validatorAddress, deposit: 0, delegatedStake: 0 };
	const validatorBefore = stakingContractBefore.validators.find(validator => validator.address === validatorAddress)
		|| { address: validatorAddress, deposit: 0, delegatedStake: 0 };

	const validatorStakeRatioNow = (validatorNow.deposit + validatorNow.delegatedStake) / stakingContractNow.totalStake;
	const validatorStakeRatioBefore = (validatorBefore.deposit + validatorBefore.delegatedStake)
		/ stakingContractBefore.totalStake;

	const validatorStakeRatio = Math.min(validatorStakeRatioNow, validatorStakeRatioBefore);

	const dbSignificantDigits = tx.validator_stake_ratio.toString(10).replace(/^0\./, "").length;

	const stakeRatioWithSameSignificantDigits = Math.round(validatorStakeRatio * 10 ** dbSignificantDigits)
		/ 10 ** dbSignificantDigits;

	const changesUnderdogStatus = (tx.validator_stake_ratio < 0.1 && validatorStakeRatio >= 0.1)
		|| (tx.validator_stake_ratio >= 0.1 && validatorStakeRatio < 0.1);

	const diff = stakeRatioWithSameSignificantDigits - tx.validator_stake_ratio;

	if (Math.abs(diff) > 10e-3 || changesUnderdogStatus) {
		const res = await db
			.update(schema.prestakingTransactions)
			.set({ validator_stake_ratio: validatorStakeRatio })
			.where(eq(schema.prestakingTransactions.transaction_hash, transaction.hash))
			.returning({ hash: schema.prestakingTransactions.transaction_hash });
		console.log(
			"Updated transaction",
			res[0].hash,
			tx.validator_stake_ratio,
			stakeRatioWithSameSignificantDigits,
			diff,
		);
	}
}

console.log("Processed", count, "pre-staking transactions");

await db.$client.end({ timeout: 5 });

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
								},
							},
						},
					},
				},
			},
		},
	});

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
				if (transaction.block_height! > height) return total;
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
