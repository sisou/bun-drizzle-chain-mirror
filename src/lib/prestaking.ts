const network = process.env.NETWORK || "testnet";
const isMainnet = network.includes("main");

export const BURN_ADDRESS = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

/**
 * Validator deposit in luna.
 */
export const VALIDATOR_DEPOSIT = 100_000e5;

export const REGISTRATION_START_HEIGHT = isMainnet ? 3_357_600 : Infinity;
export const REGISTRATION_END_HEIGHT = isMainnet ? 3_392_200 : Infinity;

/**
 * Minimum amount of luna that must be delegated (staked).
 */
export const MIN_DELEGATION = 100e5;

export const PRESTAKING_START_HEIGHT = isMainnet ? 3_392_200 : Infinity;
export const PRESTAKING_END_HEIGHT = isMainnet ? 3_456_000 : Infinity;
