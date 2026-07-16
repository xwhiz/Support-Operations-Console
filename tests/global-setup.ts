import "dotenv/config";
import { runMigrations } from "../src/db/run-migrations";

/** Migrate the dedicated test database once before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL (or DATABASE_URL) is required for tests");
  await runMigrations(url);
}
