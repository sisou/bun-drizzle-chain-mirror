import TestnetGenesisAccounts from "./genesis-accounts.testnet.json" with { type: "json" };
import { postprocess } from "./postprocess";

await postprocess(TestnetGenesisAccounts);
