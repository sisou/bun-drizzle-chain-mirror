const network = process.env.NETWORK || "testnet";
const isMainnet = network.includes("main");

export const TRANSITION_BLOCK = isMainnet ? 3_456_000 : 3_032_010;

const BLOCKS_PER_BATCH = 60;
const BATCHES_PER_EPOCH = 720;
const BLOCKS_PER_EPOCH = BLOCKS_PER_BATCH * BATCHES_PER_EPOCH;

export function isMacroBlockAt(blockNumber: number): boolean {
	// No macro blocks before genesis
	if (blockNumber < TRANSITION_BLOCK) {
		return false;
	} else {
		return batchIndexAt(blockNumber) === BLOCKS_PER_BATCH - 1;
	}
}

export function isElectionBlockAt(blockNumber: number): boolean {
	// No election blocks before genesis
	if (blockNumber < TRANSITION_BLOCK) {
		return false;
	} else {
		return epochIndexAt(blockNumber) === BLOCKS_PER_EPOCH - 1;
	}
}

function batchIndexAt(blockNumber: number): number {
	// No batches before the genesis block number
	if (blockNumber < TRANSITION_BLOCK) {
		return blockNumber;
	} else {
		const blocksSinceGenesis = blockNumber - TRANSITION_BLOCK;
		return (blocksSinceGenesis + BLOCKS_PER_BATCH - 1) % BLOCKS_PER_BATCH;
	}
}

function epochIndexAt(blockNumber: number): number {
	// Any block before the genesis is considered to be part of epoch 0
	if (blockNumber < TRANSITION_BLOCK) {
		return blockNumber;
	} else {
		const blocksSinceGenesis = blockNumber - TRANSITION_BLOCK;
		return (blocksSinceGenesis + BLOCKS_PER_EPOCH - 1) % BLOCKS_PER_EPOCH;
	}
}
