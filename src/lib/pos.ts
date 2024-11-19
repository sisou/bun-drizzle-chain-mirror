const network = process.env.NETWORK || "testnet";
const isMainnet = network.includes("main");

const TRANSITION_BLOCK = isMainnet ? 3_456_000 : 3_032_010;

const BLOCKS_PER_BATCH = 60;
const BATCHES_PER_EPOCH = 720;

export function isMacroBlockAt(block_number: number): boolean {
	// No macro blocks before genesis
	if (block_number < TRANSITION_BLOCK) {
		return false;
	} else {
		return batchIndexAt(block_number) === BLOCKS_PER_BATCH - 1;
	}
}

function batchIndexAt(block_number: number): number {
	// No batches before the genesis block number
	if (block_number < TRANSITION_BLOCK) {
		return block_number;
	} else {
		const blocks_since_genesis = block_number - TRANSITION_BLOCK;
		return (blocks_since_genesis + BLOCKS_PER_BATCH - 1) % BLOCKS_PER_BATCH;
	}
}
