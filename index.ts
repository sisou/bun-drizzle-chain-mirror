import { desc } from "drizzle-orm";
import { blocks } from "./db/schema";
import { db } from "./src/database";
import { blockNumber } from "./src/rpc";
import { writeBlocks } from "./src/startup";

// Step 1: Catch up to the chain

let dbHeight = 0;
let chainHeight: number;

do {
	const dbHeightResult = await db.select({ height: blocks.height }).from(blocks).orderBy(desc(blocks.height)).limit(1);
	if (dbHeightResult.length) dbHeight = dbHeightResult[0].height;

	chainHeight = await blockNumber();
	console.info(`DB height: ${dbHeight} - Chain height: ${chainHeight}: ${chainHeight - dbHeight} blocks behind`);

	console.log("Catching up to chain...");
	await writeBlocks(dbHeight + 1, chainHeight);
} while (dbHeight < chainHeight);

console.log("Caught up!");

// Step 2: Start listening for blocks live
// (Also handle missing blocks in between.)
