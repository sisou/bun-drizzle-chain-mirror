import GenesisAccounts from "./genesis-accounts.mainnet.json";
import { seed } from "./seed";

await seed(GenesisAccounts.map((account) => ({
	...account,
	creation_data: account.creation_data ? Buffer.from(account.creation_data, "hex") : null,
})));
