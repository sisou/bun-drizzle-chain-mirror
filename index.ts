import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { blocks, transactions } from "./db/schema";
import { db } from "./src/database";
import { blockNumber, getBlockByNumber, getTransactionByHash, mempoolContent, type Transaction } from "./src/rpc";
import { writeBlocks, writeMempoolTransactions } from "./src/writer";

// Step 1: Catch up to the chain

let dbHeight = 0;
let chainHeight: number;
/**
 * A set of transaction hashes that are in the mempool.
 */
const mempool = new Set<string>();

do {
	const dbHeightResult = await db.select({ height: blocks.height }).from(blocks).orderBy(desc(blocks.height)).limit(1);
	if (dbHeightResult.length) dbHeight = dbHeightResult[0].height;

	chainHeight = await blockNumber();
	console.info(`DB height: #${dbHeight} - Chain height: #${chainHeight}: ${chainHeight - dbHeight} blocks behind`);

	// Only catch up until 100 blocks behind, the rest will be done with polling below.
	// Because only the polling method can handle reorgs.
	if (dbHeight > chainHeight - 100) break;

	console.log("Catching up to chain...");
	await writeBlocks(dbHeight + 1, chainHeight - 99);
} while (dbHeight < chainHeight);

console.log("Caught up!");

// Delete all non-included transactions, in case there were any left when the writer last exited
const deleted = await db.delete(transactions).where(isNull(transactions.date));
console.log(`Deleted ${deleted.count} non-included transactions`);

// Step 2: Start listening for blocks live
// (Also handle missing blocks in between.)

async function pollChain() {
	const currentHeight = await blockNumber();
	// Do not handle reorgs of the current block
	if (currentHeight === dbHeight) return;

	// Find nearest common ancestor
	const firstNewHeight = Math.min(dbHeight + 1, currentHeight);
	let firstNewBlock = await getBlockByNumber(firstNewHeight, false);
	let commonAncestorHeight = firstNewHeight - 1;
	let forked = firstNewHeight <= dbHeight;
	while (commonAncestorHeight) {
		const ancestorHash = await db.select({ hash: blocks.hash }).from(blocks).where(
			eq(blocks.height, commonAncestorHeight),
		).limit(1).then(res => res.at(0)?.hash);
		if (ancestorHash === firstNewBlock.parentHash) break;
		// Fetch parent block
		firstNewBlock = await getBlockByNumber(commonAncestorHeight, false);
		forked = true;
		commonAncestorHeight--;
	}

	console.info(
		`Writing new blocks: #${commonAncestorHeight + 1} - #${currentHeight} (${forked ? "forked" : "extended"})`,
	);
	await writeBlocks(commonAncestorHeight + 1, currentHeight, { forked, mempool });
	dbHeight = currentHeight;
}

async function pollMempool() {
	const transactionHashes = await mempoolContent(false);

	const newHashes = transactionHashes.filter(hash => !mempool.has(hash));
	if (newHashes.length) console.log("Mempool new hashes:", newHashes);
	const removedHashes = Array.from(mempool.keys()).filter(hash => !transactionHashes.includes(hash));
	if (removedHashes.length) console.log("Mempool removed hashes:", removedHashes);

	// For new hashes, fetch transactions and add to database
	const newTxs = (await Promise.all(
		newHashes.map((hash) => getTransactionByHash(hash)),
	)).filter(Boolean) as Transaction[];
	await writeMempoolTransactions(newTxs);
	for (const tx of newTxs) mempool.add(tx.hash);

	// For removed hashes, remove non-included transactions from database
	// Included transactions get removed from `mempool` by writeBlocks, so this is just for expired or overlooked transactions
	for (const hash of removedHashes) {
		await db.delete(transactions).where(and(
			eq(transactions.hash, sql.raw(`'\\x${hash}'`)),
			isNull(transactions.date),
		));
		mempool.delete(hash);
	}

	console.assert(mempool.size === transactionHashes.length, "Mempool size mismatch");
}

async function poll() {
	await pollChain();
	await pollMempool();
	// Call itself again after 1s (waiting 1s _between_ polls)
	setTimeout(poll, 1e3);
}

// Kick off polling
console.log("Polling chain for new blocks and transactions...");
poll();
