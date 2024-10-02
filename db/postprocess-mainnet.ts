import MainnetGenesisAccounts from "./genesis-accounts.mainnet.json" with { type: "json" };
import { postprocess } from "./postprocess";

await postprocess(MainnetGenesisAccounts);
