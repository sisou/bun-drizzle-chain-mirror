import type { Config } from "drizzle-kit";

export default {
	schema: "./db/schema.ts",
	driver: "pg",
	dbCredentials: {
		// biome-ignore lint/style/noNonNullAssertion: we know this is set
		connectionString: process.env.DATABASE_URL!,
	},
	verbose: true,
	strict: true,
} satisfies Config;
