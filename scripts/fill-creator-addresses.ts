import { and, eq, gte, isNotNull } from "drizzle-orm";
import { blocks } from "../db/schema";
import { db } from "../src/database";
import { TRANSITION_BLOCK } from "../src/lib/pos";
import { getBlockByNumber } from "../src/pos/rpc";

const firstFilledBlock = await db.query.blocks.findFirst({
	where: and(
		gte(blocks.height, TRANSITION_BLOCK),
		isNotNull(blocks.creator_address),
	),
	columns: {
		height: true,
	},
});

if (!firstFilledBlock) {
	console.error("No blocks to update");
	process.exit(1);
}

console.log(`Starting from block ${firstFilledBlock.height}`);

let currentHeight = firstFilledBlock.height;

while (currentHeight >= TRANSITION_BLOCK) {
	if (await updateBlock(currentHeight)) break;
	currentHeight--;
}

async function updateBlock(number: number) {
	const block = await getBlockByNumber(currentHeight, false);
	if (!block) {
		console.log(`Block ${currentHeight} not found`);
		return true;
	}

	if (block.type === "macro") {
		console.log(`Block ${currentHeight} is a macro block`);
		return false;
	}

	await db.update(blocks).set({ creator_address: block.producer.validator }).where(
		eq(blocks.height, currentHeight),
	);

	console.log(`Block ${currentHeight} updated`);

	return false;
}
