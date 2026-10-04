import { and, between, desc, eq, gt, sql } from "drizzle-orm";
import { db, pg } from "../src/database";
import { isMacroBlockAt, TRANSITION_BLOCK } from "../src/lib/pos";
import { closeSockets, getTransactionsByBlockNumber } from "../src/pos/rpc";
import { toTransactionInsert } from "../src/writer";
import { postprocess } from "./postprocess";
import { blocks, transactions } from "./schema";

/** How many block heights to check for missing transactions per database query. */
const SCAN_BATCH_BLOCKS = 100_000;

/** How many blocks to fetch from the RPC server in parallel. */
const FETCH_BATCH_BLOCKS = 20;

/** A block with at least this many dust transactions counts as a spam block. */
const SPAM_THRESHOLD = 5;

/** This many consecutive spam blocks mark the start of the spam period, where the scan stops. */
const SPAM_STREAK = 30;

await postprocess(async () => {
	await restoreSignallingTransactions();
});

// Don't forget to close the connections, otherwise the script might hang
console.log("Closing database and RPC connections");
await pg.end({ timeout: 5 });
closeSockets();

/**
 * The testnet spam filter used to drop all transactions with a value below 10 luna, which also dropped signalling
 * transactions (value 0). Walk the blocks backwards, refetch the ones that have fewer transactions stored than they
 * contain, and restore their signalling transactions. Stops when reaching the spam period.
 */
async function restoreSignallingTransactions() {
	const topHeight = await db.select({ height: blocks.height }).from(blocks).orderBy(desc(blocks.height)).limit(1)
		.then(res => res.at(0)?.height);
	if (!topHeight) return;

	console.log(`Restoring signalling transactions from #${topHeight} backwards`);

	let restored = 0;
	// Consecutive spam blocks seen so far. Carried across batches, as a streak can span them.
	let spamStreak = 0;
	let previousHeight = 0;
	for (let hi = topHeight; hi >= TRANSITION_BLOCK; hi -= SCAN_BATCH_BLOCKS) {
		const lo = Math.max(hi - SCAN_BATCH_BLOCKS + 1, TRANSITION_BLOCK);

		const counts = db.select({
			height: transactions.block_height,
			count: sql<number>`COUNT(*)`.as("count"),
		})
			.from(transactions)
			.where(between(transactions.block_height, lo, hi))
			.groupBy(transactions.block_height)
			.as("counts");

		const heights = await db.select({ height: blocks.height })
			.from(blocks)
			.leftJoin(counts, eq(counts.height, blocks.height))
			.where(and(
				between(blocks.height, lo, hi),
				gt(blocks.transaction_count, sql`COALESCE(${counts.count}, 0)`),
			))
			.orderBy(desc(blocks.height))
			.then(res => res.map(row => row.height));

		for (let i = 0; i < heights.length; i += FETCH_BATCH_BLOCKS) {
			const batch = heights.slice(i, i + FETCH_BATCH_BLOCKS);
			const blockTransactions = await Promise.all(batch.map(height => getTransactionsByBlockNumber(height)));

			let stopIndex = -1;
			for (const [j, txs] of blockTransactions.entries()) {
				const height = batch[j];
				const isSpam = txs.filter(tx => tx.value > 0 && tx.value < 10).length >= SPAM_THRESHOLD;
				// Blocks are in descending order, so the streak continues when this block sits directly below the
				// previous one. Macro blocks never contain transactions, so they do not interrupt a streak.
				const isAdjacent = height === previousHeight - 1
					|| (height === previousHeight - 2 && isMacroBlockAt(previousHeight - 1));
				spamStreak = isSpam ? (isAdjacent ? spamStreak + 1 : 1) : 0;
				previousHeight = height;
				if (spamStreak >= SPAM_STREAK) {
					stopIndex = j;
					break;
				}
			}

			// Signalling transactions are restored in spam blocks as well, as long as they are above the stop
			const signallingTxs = blockTransactions
				.slice(0, stopIndex === -1 ? undefined : stopIndex + 1)
				.flat()
				.filter(tx => tx.value === 0);

			if (signallingTxs.length) {
				const inserted = await db.insert(transactions)
					.values(signallingTxs.map(tx => toTransactionInsert(tx, tx.executionResult)))
					.onConflictDoNothing();
				restored += inserted.count;
				console.log(
					`Restored ${inserted.count} signalling transactions in #${batch.at(-1)} - #${batch[0]}`,
				);
			}

			if (stopIndex !== -1) {
				console.log(`Reached spam period at #${batch[stopIndex]}, done restoring ${restored} signalling transactions`);
				return;
			}
		}

		console.log(`Checked #${lo} - #${hi} (${heights.length} blocks with missing transactions)`);
	}

	console.log(`Reached transition block, done restoring ${restored} signalling transactions`);
}
