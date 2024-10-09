import { sql } from "drizzle-orm";
import { db } from "../src/database";
import { Account, accounts } from "./schema";

export async function seed(inserts: (Account & { creation_data: string | null })[]) {
	if (!inserts.length) {
		console.log("No genesis accounts to seed, exiting!");
		return exit(1);
	}

	const [{ count }] = await db.select({
		count: sql<number>`cast(count(*) as int)`,
	}).from(accounts);

	if (count > 0) {
		console.log("Database already seeded, exiting!");
		return exit(0);
	}

	console.log("Seeding genesis accounts...");

	await db.insert(accounts).values(inserts);

	console.log("Seeding complete");

	return exit(0);
}

async function exit(code: number) {
	// Don't forget to close the connection, otherwise the script might hang
	console.log("Closing database");
	await db.$client.end({ timeout: 5 });

	process.exit(code);
}
