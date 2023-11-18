type Account =
	& {
		id: string;
		address: string;
		balance: number;
	}
	& ({
		type: 0;
	} | {
		type: 1;
		owner: string;
		ownerAddress: string;
		vestingStart: number;
		vestingStepBlocks: number;
		vestingStepAmount: number;
		vestingTotalAmount: number;
	} | {
		type: 2;
		sender: string;
		senderAddress: string;
		recipient: string;
		recipientAddress: string;
		hashRoot: string;
		hashAlgorithm: number;
		hashCount: number;
		timeout: number;
		totalAmount: number;
	});

export async function getAccount(address: string): Promise<Account> {
	return rpc<Account>("getAccount", [address]);
}

export async function sendTransaction(transaction: string): Promise<string> {
	return rpc<string>("sendRawTransaction", [transaction]);
}

export async function blockNumber(): Promise<number> {
	return rpc<number>("blockNumber");
}

export type Transaction = {
	hash: string;
	blockHash?: string;
	blockNumber?: number;
	timestamp?: number;
	confirmations: number;
	from: string;
	fromAddress: string;
	fromType: number;
	to: string;
	toAddress: string;
	toType: number;
	value: number;
	fee: number;
	data: string | null;
	proof: string | null;
	flags: number;
	validityStartHeight: number;
	networkId: number;
};

export async function mempoolContent(): Promise<Transaction[]> {
	return rpc<Transaction[]>("mempoolContent", [true]);
}

export type Block = {
	number: number;
	hash: string;
	pow: string;
	parentHash: string;
	nonce: number;
	bodyHash: string;
	accountsHash: string;
	difficulty: number;
	timestamp: number;
	confirmations: number;
	miner: string;
	minerAddress: string;
	extraData: string;
	size: number;
	transactions: string[];
};

export type BlockWithTxs = Omit<Block, "transactions"> & {
	transactions: Required<Transaction>[];
};

export async function getBlockByNumber<WithTx extends boolean>(
	number: number,
	withTxs: WithTx,
): Promise<WithTx extends true ? BlockWithTxs : Block> {
	return rpc<WithTx extends true ? BlockWithTxs : Block>("getBlockByNumber", [number, withTxs]);
}

let rpc_request_id = 0;

async function rpc<Type>(method: string, params: (string | number | boolean)[] = []): Promise<Type> {
	const rpc_url = process.env.RPC_SERVER;
	if (!rpc_url) throw new Error("RPC_SERVER environment variable is not set");

	const authorization_header = process.env.RPC_USERNAME && process.env.RPC_PASSWORD
		? `Basic ${btoa(`${process.env.RPC_USERNAME}:${process.env.RPC_PASSWORD}`)}`
		: undefined;

	const request_id = ++rpc_request_id;

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
				result: Type;
			} | {
				error: {
					code: number;
					message: string;
				};
			})
		>;
	});

	if ("error" in response) {
		throw new Error(`RPC error: ${response.error.message}`);
	}

	if (response.id !== request_id) {
		throw new Error("RPC response id does not match request id");
	}

	return response.result as Type;
}
