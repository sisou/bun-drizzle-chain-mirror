import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_POOLER_URL;
if (!url) throw new Error("DATABASE_POOLER_URL environment variable is not set");

console.log("Opening PostgreSQL database");
export const pg = postgres(url);
export const db = drizzle(pg);
