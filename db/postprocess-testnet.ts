import { eq, isNull, or } from "drizzle-orm";
import { db } from "../src/database";
import { getAccount as getPoSAccount } from "../src/pos/rpc";
import TestnetGenesisAccounts from "./genesis-accounts.testnet.json" with { type: "json" };
import { postprocess } from "./postprocess";
import { accounts } from "./schema";

await postprocess(TestnetGenesisAccounts, async () => {
	await updateRevertedAccountBalances();
});

async function updateRevertedAccountBalances() {
	console.log("Updating reverted account balances...");

	const revertedAccounts = await db
		.select({ address: accounts.address, balance: accounts.balance })
		.from(accounts)
		.where(or(
			isNull(accounts.last_received),
			isNull(accounts.last_sent),
		));

	console.log(`Found ${revertedAccounts.length} reverted accounts`);

	let i = 1;
	for (const { address, balance } of revertedAccounts) {
		const account = await getPoSAccount(address);

		if (account.balance !== balance) {
			await db.update(accounts).set({ balance: account.balance }).where(eq(accounts.address, address));
			console.log(
				`${i}/${revertedAccounts.length} Updated balance of ${address} from ${balance} to ${account.balance}`,
			);
		}
		i++;
	}

	console.log("Done updating reverted account balances");
}
