import type { Config } from "drizzle-kit";

export default {
	dialect: "postgresql",
	schema: "./db/schema.ts",
	dbCredentials: {
		// biome-ignore lint/style/noNonNullAssertion: we know this is set
		url: process.env.DATABASE_URL!,
	},
	verbose: true,
	strict: true,
} satisfies Config;
