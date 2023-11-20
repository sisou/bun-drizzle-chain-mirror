import { desc, eq } from "drizzle-orm";
import { blocks } from "./db/schema";
import { db } from "./src/database";
import { blockNumber, getBlockByNumber } from "./src/rpc";
import { writeBlocks } from "./src/startup";

// Step 1: Catch up to the chain

let dbHeight = 0;
let chainHeight: number;

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
	await writeBlocks(commonAncestorHeight + 1, currentHeight, forked);
	dbHeight = currentHeight;
}

// Wait 1s _between_ polls
setTimeout(async () => {
	await pollChain();
	setTimeout(pollChain, 1e3);
}, 1e3);
