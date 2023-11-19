import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL environment variable is not set");

console.log("Opening PostgreSQL database");
const pg = postgres(url, { max: 1 });

// This will run migrations on the database, skipping the ones already applied
console.log("Running migrations...");
await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });

// Don't forget to close the connection, otherwise the script might hang
console.log("Closing database");
await pg.end();
