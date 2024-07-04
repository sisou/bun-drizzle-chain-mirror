import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL environment variable is not set");

console.log("Opening PostgreSQL database");
export const pg = postgres(url, { max: 1 });
export const db = drizzle(pg, { schema });
