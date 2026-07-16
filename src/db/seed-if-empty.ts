import "dotenv/config";
import { sql } from "drizzle-orm";
import { pool, db } from "./client";
import { users } from "./schema";
import { runSeed } from "./seed-core";

/** Seeds only when the database is empty — safe to run on every prod start. */
async function main() {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if ((row?.count ?? 0) > 0) {
    console.log(`Seed skipped: ${row.count} users already present.`);
    return;
  }
  await runSeed(db);
}

main()
  .catch((err) => {
    console.error("Seed-if-empty failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
