const network = process.env.NETWORK || "testnet";
const isMainnet = network.includes("main");

export const BURN_ADDRESS = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

/**
 * Validator deposit in luna.
 */
export const VALIDATOR_DEPOSIT = 100_000e5;

export const REGISTRATION_START_HEIGHT = isMainnet ? 3_357_600 : 3_016_530;
export const REGISTRATION_END_HEIGHT = isMainnet ? 3_392_200 : 3_022_290;

/**
 * Minimum amount of luna that must be delegated (staked).
 */
export const MIN_DELEGATION = 100e5;

export const PRESTAKING_START_HEIGHT = isMainnet ? 3_392_200 : 3_023_730;
export const PRESTAKING_END_HEIGHT = isMainnet ? 3_456_000 : 3_028_050;

export const TRANSITION_BLOCK = isMainnet ? 3_456_000 : 3_032_010;

export function getPoolAddressesAtBlockHeight(height: number) {
	const poolAddresses = [
		"NQ97 H1NR S3X0 CVFQ VJ9Y 9A0Y FRQN Q6EU D0PL", // AceStaking
		"NQ37 6EL5 BP9K XL1A 3ED0 L3EC NPR5 C9D3 BRKG", // Helvetia Staking
		"NQ53 M1NT S3JD TAGM CBTK 01PX YD3U B1DE GYHB", // Mint Pool
		"NQ05 U1RF QJNH JCS1 RDQX 4M3Y 60KR K6CN 5LKC", // NimiqHub Staking
		"NQ38 VK34 DRBL S3CN M9KM 8UJN 9JY2 2KFN VQQH", // Siam Pool
		"NQ44 V95C ABVY RARR SBMC V8VE M6UH EJP0 RXYQ", // nim.re Staking Pool
	];

	if (height >= 3394273) { // 30 minutes after deploying https://github.com/nimiq/wallet/releases/tag/v2.41.4
		poolAddresses.push("NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4"); // Keyring Staking
	}

	if (height >= 3396044) { // 30 minutes after deploying https://github.com/nimiq/wallet/releases/tag/v2.41.6
		poolAddresses.push("NQ98 D3KE 8EQ8 Y7DK G1MT 3P5T 2PHX 18V5 UEC1"); // Moon Pool
	}

	return poolAddresses;
}
