import TestnetGenesisAccounts from "./genesis-accounts.testnet.json" with { type: "json" };
import { seed } from "./seed";

await seed(TestnetGenesisAccounts);
