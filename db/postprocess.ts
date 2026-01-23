import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/database";
import { inherents } from "./schema";

export async function postprocess(callback?: () => void | Promise<void>) {
	if (callback) await callback();

	await extractRewardInherentTargetAddress();
}

async function extractRewardInherentTargetAddress() {
	const count = await db.$count(
		inherents,
		and(
			eq(inherents.type, "reward"),
			isNull(inherents.target_address),
		),
	);

	console.log(`Found ${count} reward inherents without target_address set`);

	let progress = 0;

	while (true) {
		const dbInherents = await db.query.inherents.findMany({
			where: and(
				eq(inherents.type, "reward"),
				isNull(inherents.target_address),
			),
			limit: 1000,
			columns: {
				id: true,
				data: true,
			},
		});

		if (!dbInherents.length) break;

		for (const inh of dbInherents) {
			const data = inh.data as { target?: string };
			const target_address = data.target;
			delete data.target;

			await db.update(inherents)
				.set({
					target_address: target_address,
					data: data,
				})
				.where(eq(inherents.id, inh.id));
		}

		progress += dbInherents.length;

		console.log(
			`Processed batch of ${dbInherents.length} inherents (${progress}/${count}, ${
				((progress / count) * 100).toFixed(2)
			}%)`,
		);
	}
}
