import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

console.log("Opening database", process.env.DATABASE_URL || "/tmp/sqlite.db");
export const sqlite = new Database(process.env.DATABASE_URL || "/tmp/sqlite.db");
export const db = drizzle(sqlite);
