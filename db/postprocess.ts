import { and, eq, isNull } from "drizzle-orm";
import { db, pg } from "../src/database";
import { inherents } from "./schema";

export async function postprocess(callback?: () => void | Promise<void>) {
	if (callback) await callback();

	const count = await db.$count(
		inherents,
		and(
			eq(inherents.type, "reward"),
			isNull(inherents.target_address),
		),
	);

	console.log(`Found ${count} reward inherents without target_address set`);

	console.log("Closing database");
	await pg.end({ timeout: 5 });
}
