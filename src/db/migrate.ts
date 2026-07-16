import "dotenv/config";
import { runMigrations } from "./run-migrations";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");
  await runMigrations(url);
  // Redact credentials when logging the target.
  console.log(`Migrations applied to ${url.replace(/\/\/[^@]*@/, "//***@")}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
