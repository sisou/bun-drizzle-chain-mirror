type BaseAccount = {
	address: string;
	balance: number;
};

type BasicAccount = BaseAccount & {
	type: "basic";
};

type VestingAccount =
	& BaseAccount
	& {
		type: "vesting";
		owner: string;
		vestingStepAmount: number;
		vestingTotalAmount: number;
	}
	& ({
		// Wrong types in RC5
		vestingStart: number;
		vestingStepBlocks: number;
	} | {
		// Fixed in v1.0.0
		/**
		 * In milliseconds
		 */
		vestingStartTime: number;
		/**
		 * In milliseconds
		 */
		vestingTimeStep: number;
	});

type HtlcAccount = BaseAccount & {
	type: "htlc";
	sender: string;
	recipient: string;
	hashRoot: {
		algorithm: "sha256" | "sha512";
		hash: string;
	};
	hashCount: number;
	/**
	 * In milliseconds
	 */
	timeout: number;
	totalAmount: number;
};

type StakingAccount = BaseAccount & {
	type: "staking";
};

type Account = BasicAccount | VestingAccount | HtlcAccount | StakingAccount;

export async function getAccount(address: string): Promise<Account> {
	return rpc<Account>("getAccountByAddress", address);
}

export async function sendTransaction(transaction: string): Promise<string> {
	return rpc<string>("sendRawTransaction", transaction);
}

export async function blockNumber(): Promise<number> {
	return rpc<number>("getBlockNumber");
}

export type Transaction = {
	hash: string;
	blockNumber?: number;
	/**
	 * In milliseconds
	 */
	timestamp?: number;
	confirmations: number;
	from: string;
	fromType: number;
	to: string;
	toType: number;
	value: number;
	fee: number;
	senderData: string;
	recipientData: string;
	flags: number;
	validityStartHeight: number;
	proof: string;
	networkId: number;
	executionResult: boolean;
};

export async function mempoolContent(fullTxs: false): Promise<string[]>;
export async function mempoolContent(fullTxs: true): Promise<Transaction[]>;
export async function mempoolContent(fullTxs: boolean): Promise<string[] | Transaction[]> {
	return rpc<string[] | Transaction[]>("mempoolContent", fullTxs);
}

export async function getTransactionByHash(hash: string): Promise<Transaction | null> {
	return rpc<Transaction | null>("getTransactionByHash", hash);
}

type BaseBlock = {
	hash: string;
	size: number;
	batch: number;
	epoch: number;
	network: "MainAlbatross" | "TestAlbatross";
	version: number;
	number: number;
	timestamp: number;
	parentHash: string;
	seed: string;
	extraData: string;
	stateHash: string;
	bodyHash: string;
	historyHash: string;
};

type MacroBlock =
	& BaseBlock
	& {
		type: "macro";
		parentElectionHash: string;
		nextBatchInitialPunishedSet: number[];
		justification: {
			round: number;
			sig: {
				signature: {
					signature: string;
				};
				signers: number[];
			};
		};
	}
	& ({
		isElectionBlock: true;
		interlink: string[];
		slots: {
			firstSlotNumber: number;
			numSlots: number;
			validator: string;
			publicKey: string;
		}[];
	} | {
		isElectionBlock: false;
	});

type MicroBlock = BaseBlock & {
	type: "micro";
	producer: {
		slotNumber: number;
		validator: string;
		publicKey: string;
	};
	justification: {
		micro: string;
	} | {
		skip: {
			sig: {
				signature: { signature: string };
				signers: number[];
			};
		};
	};
};

export type Block = MacroBlock | MicroBlock;

export type BlockWithTxs = Block & {
	transactions: Required<Transaction>[];
};

export async function getBlockByNumber<WithTx extends boolean>(
	number: number,
	withTxs: WithTx,
): Promise<WithTx extends true ? BlockWithTxs : Block> {
	return rpc<WithTx extends true ? BlockWithTxs : Block>("getBlockByNumber", number, withTxs);
}

let rpc_request_id = 0;

async function rpc<Type>(method: string, ...params: (string | string[] | number | boolean)[]): Promise<Type> {
	const rpc_url = process.env.POS_RPC_SERVER;
	if (!rpc_url) throw new Error("POS_RPC_SERVER environment variable is not set");

	const authorization_header = process.env.POS_RPC_USERNAME || process.env.POS_RPC_PASSWORD
		? `Basic ${btoa(`${process.env.POS_RPC_USERNAME}:${process.env.POS_RPC_PASSWORD}`)}`
		: undefined;

	const request_id = ++rpc_request_id;
	if (rpc_request_id >= Number.MAX_SAFE_INTEGER) rpc_request_id = 0;

	const response = await fetch(rpc_url, {
		method: "POST",
		headers: {
			...(authorization_header ? { Authorization: authorization_header } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			method,
			params,
			id: request_id,
		}),
	}).then(response => {
		if (!response.ok) throw new Error(`RPC error: ${response.status} ${response.statusText}`);

		return response.json() as Promise<
			& {
				jsonrpc: "2.0";
				id: number;
			}
			& ({
				result: {
					data: Type;
					metadata: unknown;
				};
			} | {
				error: {
					code: number;
					message: string;
					data: string;
				};
			})
		>;
	});

	if ("error" in response) {
		throw new Error(`RPC error: ${response.error.message} - ${response.error.data}`);
	}

	if (response.id !== request_id) {
		throw new Error("RPC response id does not match request id");
	}

	return response.result.data as Type;
}
