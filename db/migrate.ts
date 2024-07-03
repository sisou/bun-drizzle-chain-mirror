import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pg } from "../src/database";

// This will run migrations on the database, skipping the ones already applied
console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./drizzle" });

// Don't forget to close the connection, otherwise the script might hang
console.log("Closing database");
await pg.end({ timeout: 5 });
