import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";

/** A Drizzle client bound to the test database. Caller must `pool.end()`. */
export function makeTestDb() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("no test database url");
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

const ALL_TABLES = [
  "execution_attempts",
  "replacements",
  "cancellations",
  "refunds",
  "escalations",
  "proposed_actions",
  "tool_calls",
  "agent_messages",
  "agent_runs",
  "support_requests",
  "payments",
  "order_items",
  "orders",
  "users",
];

/** Wipe all domain tables for a clean test slate. */
export async function truncateAll(pool: Pool) {
  await pool.query(
    `TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

/** Extract the underlying pg error code/message from a Drizzle-wrapped error. */
export function pgError(e: unknown): { code?: string; message: string } {
  const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const inner = err?.cause ?? err;
  return { code: inner?.code, message: String(inner?.message ?? err?.message ?? e) };
}
