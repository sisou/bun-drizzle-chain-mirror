import { Account, Address } from "@sisou/nimiq-ts";
import { count, eq } from "drizzle-orm";
import { db, pg } from "../src/database";
import genesisAccounts from "./genesis-accounts.testnet.json" with { type: "json" };
import { accounts, transactions, vestingOwners } from "./schema";

const [{ count: vestingOwnersCount }] = await db.select({ count: count() }).from(vestingOwners);
if (!vestingOwnersCount) {
	console.log("Populating vesting owners table...");

	const vestingAccounts = await db
		.select({ address: accounts.address })
		.from(accounts)
		.where(eq(accounts.type, 1));

	let failed = false;

	console.log(`Populating owners for ${vestingAccounts.length} contracts`);

	let i = 0;

	for (const { address } of vestingAccounts) {
		// Find creation data of the contract
		console.log(`Processing contract ${address} (${++i}/${vestingAccounts.length})`);

		// Either from the genesis file
		const genesisAccount = genesisAccounts.find(({ address: addr, type }) =>
			addr === address && type === Account.Type.VESTING
		);
		if (genesisAccount?.creation_data) {
			console.debug("Found creation_data in genesis accounts file");
			const owner = Address.fromHex(genesisAccount.creation_data.substring(0, 40)).toUserFriendlyAddress();
			await db.insert(vestingOwners).values({ address, owner });
			continue;
		}

		// Or from the blockchain
		const creationTransaction = await db
			.select({ creation_data: transactions.recipient_data })
			.from(transactions)
			.where(eq(transactions.recipient_address, address))
			.limit(1);

		if (!creationTransaction.length) {
			console.error(`Could not find creation transaction for vesting account ${address}`);
			failed = true;
			break;
		}

		const creation_data = creationTransaction[0].creation_data;

		if (!creation_data) {
			console.error(`Could not find creation data for vesting account ${address}`);
			failed = true;
			break;
		}

		console.debug("Found creation_data in creation transaction");
		const owner = Address.fromHex(creation_data.substring(0, 40)).toUserFriendlyAddress();
		await db.insert(vestingOwners).values({ address, owner }).onConflictDoNothing();
	}

	if (!failed) {
		console.log("Done");
	}
} else {
	console.log("Vesting owners table already populated");
}

console.log("Closing database");
await pg.end({ timeout: 5 });
