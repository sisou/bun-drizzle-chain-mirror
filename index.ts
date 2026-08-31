import { UTCDateMini } from "@date-fns/utc";
import { addHours, addMinutes } from "date-fns";
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { blocks, restakeTransactionsGrouped, transactions } from "./db/schema";
import { db } from "./src/database";
import { isMainnet } from "./src/lib/pos";
import { getBlockByNumber, getBlockNumber, mempoolContent } from "./src/pos/rpc";
import { rescanExecutionResults } from "./src/rescan-executed";
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
	chainHeight = await getBlockNumber();
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
	const currentHeight = await getBlockNumber();
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
		if (!ancestorHash || !firstNewBlock || ancestorHash === firstNewBlock.parentHash) break;
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

	try {
		ws.send(JSON.stringify({ password: process.env.WEBSOCKET_PASSWORD, height: dbHeight }));
	} catch (error) {
		console.error("Failed to send WS update:", error);
	}
}

async function pollMempool() {
	const mempoolTransactions = await mempoolContent(true);
	const transactionHashes = mempoolTransactions.map(tx => tx.hash).filter(Boolean);

	const newHashes = transactionHashes.filter(hash => !mempool.has(hash));
	if (newHashes.length) console.log("Mempool new hashes:", newHashes);
	const removedHashes = Array.from(mempool.keys()).filter(hash => !transactionHashes.includes(hash));
	if (removedHashes.length) console.log("Mempool removed hashes:", removedHashes);

	// For new hashes, fetch transactions and add to database
	const newTxs = mempoolTransactions.filter(tx => newHashes.includes(tx.hash));
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

	// Call itself again after 200ms
	setTimeout(poll, 200);
}

// Kick off polling
console.log("Polling chain for new blocks and transactions...");
poll();

// Connect websocket to frontend to notify of new blocks
let ws: WebSocket;
function connectWS() {
	const url = process.env.WEBSOCKET_URL;
	if (!url) {
		return console.error("Missing WEBSOCKET_URL env variable, cannot start websocket");
	}

	// Set up websocket connection
	ws = new WebSocket(url);
	ws.onopen = () => {
		console.log("Websocket OPENED");
		ws.send(JSON.stringify({ password: process.env.WEBSOCKET_PASSWORD, height: dbHeight }));
	};
	ws.onerror = (e) => {
		if ("message" in e) {
			console.error(`Websocket ERROR: ${e.message}`);
		} else {
			console.error("Websocket ERROR: Generic error");
		}
	};
	ws.onclose = () => {
		console.log("Websocket CLOSED");
		setTimeout(connectWS, 2000);
	};
}
connectWS();

// Update computed tables
async function computeRestakeTransactions() {
	// INSERT INTO restake_transactions_grouped (
	//     staker_address,
	//     sender_address,
	//     time_window,
	//     aggregated_value
	// )
	// SELECT
	//     related_addresses[1] AS staker_address,
	//     sender_address,
	//     DATE_TRUNC('hour', timestamp_ms) +
	//         INTERVAL '15 minutes' * FLOOR(EXTRACT(MINUTE FROM timestamp_ms) / 15) AS time_window,
	//     SUM(value) AS aggregated_value
	// FROM transactions
	// WHERE
	//     recipient_address = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
	//     AND get_byte(recipient_data, 0) = 6
	//     AND timestamp_ms IS NOT NULL
	//     AND related_addresses[1] IS NOT NULL
	//     AND timestamp_ms >= '2017-01-01 00:00:00'
	//     and timestamp_ms < '2025-09-01 00:00:00'
	// GROUP BY
	//     staker_address,
	//     time_window,
	//     sender_address;

	// Fetch latest computed timeframe
	const latest = await db.query.restakeTransactionsGrouped.findFirst({
		orderBy: desc(restakeTransactionsGrouped.time_window),
		columns: { time_window: true },
	});
	const fromTime = latest
		? addMinutes(new UTCDateMini(latest.time_window), 15) // Start next insert at the end of the latest time window
		: new UTCDateMini(isMainnet ? "2024-11-19T16:45:00Z" : "2024-11-13T20:00:00Z"); // PoS transition block time, rounded down to start of 15 minute window
	const toTime = addMinutes(fromTime, 15); // 15 minutes later

	// Do not compute time windows later than 1 hour ago, to ensure finality of computed transactions
	if (toTime > addHours(new UTCDateMini(), -1)) return false;

	console.log(`Computing restake transactions from ${fromTime.toISOString()} to ${toTime.toISOString()}`);
	const selectQuery = db.select({
		staker_address: sql<string>`${transactions.related_addresses}[1]`.as("staker_address"),
		sender_address: transactions.sender_address,
		time_window: sql<
			Date
		>`DATE_TRUNC('hour', ${transactions.date}) + INTERVAL '15 minutes' * FLOOR(EXTRACT(MINUTE FROM ${transactions.date}) / 15)`
			.as("time_window"),
		aggregated_value: sql<number>`SUM(${transactions.value})`.as("aggregated_value"),
	})
		.from(transactions)
		.where(and(
			eq(transactions.recipient_address, "NQ77 0000 0000 0000 0000 0000 0000 0000 0001"),
			sql`get_byte(${transactions.recipient_data}, 0) = 6`,
			// Failed restakes never moved any value
			eq(transactions.executed, true),
			isNotNull(transactions.date),
			isNotNull(sql`${transactions.related_addresses}[1]`),
			gte(transactions.date, fromTime),
			lt(transactions.date, toTime),
		))
		.groupBy(
			sql`staker_address`,
			sql`time_window`,
			sql`sender_address`,
		);
	const result = await db.insert(restakeTransactionsGrouped).select(
		sql`${selectQuery.getSQL()}`, // Type hack
	);
	console.log(`Inserted ${result.count} aggregated restake transactions`);

	if (!result.count) {
		// Insert a dummy entry to mark that this timeframe has been computed
		await db.insert(restakeTransactionsGrouped).values({
			staker_address: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000",
			sender_address: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000",
			time_window: fromTime,
			aggregated_value: 0,
		});
		console.log("Inserted dummy entry for empty timeframe");
	}

	return true;
}

async function compute() {
	// Run computations for 5s
	const startTime = Date.now();
	while (Date.now() - startTime < 5e3) {
		if (!(await computeRestakeTransactions())) break;
	}

	// Call itself again after 60s
	setTimeout(compute, 60e3);
}

// Kick off computing
console.log("Computing aggregated tables...");
compute();

// Rescan transactions that were written before the writer recorded execution results
async function rescan() {
	// Run rescan batches for 5s
	const startTime = Date.now();
	while (Date.now() - startTime < 5e3) {
		// Stop rescheduling once the rescan is done
		if (!(await rescanExecutionResults())) return;
	}

	// Call itself again after 1s
	setTimeout(rescan, 1e3);
}

// Kick off rescanning
rescan();
