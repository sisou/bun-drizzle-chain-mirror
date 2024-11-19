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

export type Account = BasicAccount | VestingAccount | HtlcAccount | StakingAccount;

export async function getAccount(address: string): Promise<Account> {
	return rpc<Account>("getAccountByAddress", address);
}

export async function sendTransaction(transaction: string): Promise<string> {
	return rpc<string>("sendRawTransaction", transaction);
}

export async function getBlockNumber(): Promise<number> {
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
	size: number;
	relatedAddresses: string[];
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

// export async function getTransactionByHash(hash: string): Promise<Transaction | null> {
// 	return rpc<Transaction | null>("getTransactionByHash", hash);
// }

export async function getTransactionsByBlockNumber(number: number): Promise<Required<Transaction>[]> {
	return rpc<Required<Transaction>[]>("getTransactionsByBlockNumber", number);
}

type BaseInherent = {
	blockNumber: number;
	blockTime: number;
	validatorAddress: string;
};

type RewardInherent = BaseInherent & {
	type: "reward";
	target: string;
	value: number;
	hash: string;
};

type PenalizeInherent = BaseInherent & {
	type: "penalize";
	validatorAddress: string;
	offenseEventBlock: number;
};

type JailInherent = BaseInherent & {
	type: "penalize";
	validatorAddress: string;
	offenseEventBlock: number;
};

export type Inherent = RewardInherent | PenalizeInherent | JailInherent;

export async function getInherentsByBlockNumber(number: number): Promise<Inherent[]> {
	return rpc<Inherent[]>("getInherentsByBlockNumber", number);
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
): Promise<(WithTx extends true ? BlockWithTxs : Block) | null> {
	try {
		return await rpc<WithTx extends true ? BlockWithTxs : Block>("getBlockByNumber", number, withTxs);
	} catch (error) {
		if (error instanceof Error && error.message.includes("Block not found")) return null;
		throw error;
	}
}

async function rpc<Type>(method: string, ...params: (string | string[] | number | boolean)[]): Promise<Type> {
	const rpc_url = process.env.POS_RPC_SERVER;
	if (!rpc_url) throw new Error("POS_RPC_SERVER environment variable is not set");

	const socket = await getSocket(rpc_url + "/ws");
	return socket.call<Type>(method, ...params);
}

/**
 * Websocket
 */

const sockets = new Map<string, RpcSocket>();

async function getSocket(url: string) {
	if (sockets.has(url)) {
		const socket = sockets.get(url) as RpcSocket;
		if (socket.readyState === WebSocket.OPEN) return socket;
		socket.close();
		sockets.delete(url);
	}

	return new Promise<RpcSocket>((resolve, reject) => {
		console.log(`Opening a new WS connection to ${url}`);
		const Authorization = process.env.POS_RPC_USERNAME || process.env.POS_RPC_PASSWORD
			? `Basic ${btoa(`${process.env.POS_RPC_USERNAME}:${process.env.POS_RPC_PASSWORD}`)}`
			: undefined;
		const ws = new WebSocket(url, {
			headers: Authorization ? { Authorization } : undefined,
		});
		ws.binaryType = "arraybuffer";
		ws.addEventListener("open", () => {
			const socket = new RpcSocket(ws);
			sockets.set(url, socket);
			resolve(socket);
		});
		ws.addEventListener("error", reject);
		ws.addEventListener("close", () => {
			sockets.delete(url);
		});
	});
}

type RpcResponse<Type> =
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
	});

class RpcSocket {
	private requestId = 0;
	private callbacks = new Map<number, (response: RpcResponse<unknown>) => void>();
	private decoder = new TextDecoder();

	constructor(private ws: WebSocket) {
		ws.addEventListener("message", (event) => this.onMessage(event));
		ws.addEventListener("close", (event) => this.cleanup(event));
	}

	public async call<Type>(method: string, ...params: (string | string[] | number | boolean)[]): Promise<Type> {
		const id = ++this.requestId;
		if (this.requestId >= Number.MAX_SAFE_INTEGER) this.requestId = 0;

		return new Promise<Type>((resolve, reject) => {
			this.callbacks.set(id, response => {
				if ("error" in response) {
					reject(new Error(`RPC error: ${response.error.message} - ${response.error.data}`));
				} else {
					resolve(response.result.data as Type);
				}
			});

			this.ws.send(JSON.stringify({
				jsonrpc: "2.0",
				method,
				params,
				id,
			}));
		});
	}

	public get readyState() {
		return this.ws.readyState;
	}

	public close() {
		return this.ws.close();
	}

	private onMessage = (event: MessageEvent<unknown>) => {
		let msg: string;
		if (typeof event.data === "string") {
			msg = event.data;
		} else if (event.data instanceof ArrayBuffer) {
			msg = this.decoder.decode(event.data);
		} else {
			console.error("Invalid WS response", event.data);
			return;
		}

		const response = JSON.parse(msg) as RpcResponse<unknown>;

		const callback = this.callbacks.get(response.id);
		if (!callback) {
			console.error("No callback for WS response", response);
			return;
		}

		callback(response);
		this.callbacks.delete(response.id);
	};

	private cleanup(event: CloseEvent) {
		for (const [id, callback] of this.callbacks.entries()) {
			callback({
				jsonrpc: "2.0",
				id,
				error: {
					code: event.code,
					message: "Connection closed",
					data: "",
				},
			});
		}
	}
}
