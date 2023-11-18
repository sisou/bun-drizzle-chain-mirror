import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db, sqlite } from "../src/database";

// This will run migrations on the database, skipping the ones already applied
console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./drizzle" });

// Don't forget to close the connection, otherwise the script might hang
console.log("Closing database");
await sqlite.close();
