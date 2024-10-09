import { drizzle } from "drizzle-orm/connect";
import * as schema from "../db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL environment variable is not set");

console.log("Opening PostgreSQL database");
export const db = await drizzle("postgres-js", {
	connection: url,
	schema,
});
