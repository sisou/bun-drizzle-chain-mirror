import MainnetGenesisAccounts from "./genesis-accounts.mainnet.json" with { type: "json" };
import { seed } from "./seed";

await seed(MainnetGenesisAccounts);
