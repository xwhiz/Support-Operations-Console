import "dotenv/config";
import { pool, db } from "./client";
import { runSeed } from "./seed-core";

runSeed(db)
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
