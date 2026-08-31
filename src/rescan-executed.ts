import { Account } from "@sisou/nimiq-ts";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { accounts, transactions } from "../db/schema";
import { db } from "./database";
import { isMainnet, TRANSITION_BLOCK } from "./lib/pos";
import { type Account as RpcAccount, getAccount, getTransactionsByBlockNumber } from "./pos/rpc";

/**
 * The last block that was written before the writer started recording execution results. Everything above it is
 * written correctly and does not need to be rescanned.
 *
 * TODO: Fill in the mainnet block. Until then the rescan does nothing on mainnet.
 */
const RESCAN_TO_BLOCK = isMainnet ? null : 10_206_255;

/** How many blocks to fetch from the RPC server per batch. */
const BATCH_BLOCKS = 50;

/** The staking contract is PoS-only and therefore not part of nimiq-ts' `Account.Type`. */
const STAKING_ACCOUNT_TYPE = 3;

const ACCOUNT_TYPES: Record<RpcAccount["type"], number> = {
	basic: Account.Type.BASIC,
	vesting: Account.Type.VESTING,
	htlc: Account.Type.HTLC,
	staking: STAKING_ACCOUNT_TYPE,
};

/**
 * Where the next batch starts. Seeded from the database on the first batch, then advanced in memory: a batch that
 * finds no failed transaction leaves the database marker untouched, so relying on it alone would scan the same
 * blocks forever.
 */
let cursor: number | undefined;

async function findStartBlock(toBlock: number): Promise<number> {
	// Resume at the block holding the highest known failed transaction. The upper bound matters: without it, the
	// first correctly-written failed transaction above the rescan range would become the marker, and the rescan
	// would immediately consider itself finished.
	const latest = await db.select({ height: transactions.block_height })
		.from(transactions)
		.where(and(
			eq(transactions.executed, false),
			lte(transactions.block_height, toBlock),
		))
		.orderBy(desc(transactions.block_height))
		.limit(1)
		.then(res => res.at(0)?.height);

	return latest ?? TRANSITION_BLOCK;
}

/**
 * The old writer overwrote the recipient account type with the type claimed by the transaction, which is never
 * validated for a failed transaction. Recover the real type from the chain.
 */
async function repairRecipientTypes(addresses: Set<string>) {
	await Promise.all(
		Array.from(addresses).map(async (address) => {
			const account = await getAccount(address);
			const type = ACCOUNT_TYPES[account.type];

			// Only ever upgrade. A contract that has since been pruned reads as "basic" today, and writing that over a
			// correctly stored contract type would replace good data with bad.
			if (type === Account.Type.BASIC) return;

			const result = await db.update(accounts)
				.set({ type })
				.where(and(
					eq(accounts.address, address),
					ne(accounts.type, type),
				));

			if (result.count) console.log(`Corrected account type of ${address} to ${account.type}`);
		}),
	);
}

/**
 * Rescans one batch of transactions that were written before the writer recorded execution results, and marks the
 * failed ones accordingly. Returns false once there is nothing left to rescan.
 */
export async function rescanExecutionResults(): Promise<boolean> {
	if (RESCAN_TO_BLOCK === null) return false;

	if (cursor === undefined) {
		cursor = await findStartBlock(RESCAN_TO_BLOCK);
		console.log(`Rescanning execution results from #${cursor} to #${RESCAN_TO_BLOCK}`);
	}

	// Only transactions that are in the database can be updated, so skip over the blocks that have none.
	const heights = await db.selectDistinct({ height: transactions.block_height })
		.from(transactions)
		.where(and(
			gte(transactions.block_height, cursor),
			lte(transactions.block_height, RESCAN_TO_BLOCK),
		))
		.orderBy(asc(transactions.block_height))
		.limit(BATCH_BLOCKS)
		.then(res => res.map(row => row.height).filter(height => height !== null));

	if (!heights.length) {
		console.log(`Rescan of execution results complete (up to #${RESCAN_TO_BLOCK})`);
		return false;
	}

	const blockTransactions = await Promise.all(heights.map(height => getTransactionsByBlockNumber(height)));
	const failed = blockTransactions.flat().filter(tx => !tx.executionResult);

	const fromHeight = heights[0];
	const toHeight = heights[heights.length - 1];
	cursor = toHeight + 1;

	if (failed.length) {
		const updated = await db.update(transactions)
			.set({ executed: false })
			// Skipping rows that are already marked avoids writing dead tuples when a range is rescanned
			.where(and(
				inArray(transactions.hash, failed.map(tx => tx.hash)),
				eq(transactions.executed, true),
			));

		await repairRecipientTypes(new Set(failed.map(tx => tx.to)));

		console.log(
			`Rescanned #${fromHeight} - #${toHeight}: marked ${updated.count} of ${failed.length} failed transactions`,
		);
	} else {
		console.log(`Rescanned #${fromHeight} - #${toHeight}: no failed transactions`);
	}

	return true;
}
