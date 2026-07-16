/**
 * The single application-wide Postgres pool + Drizzle client.
 * A persistent container (Railway) means one in-process pool is the correct,
 * simplest way to handle the concurrency tests — no external pooler required.
 *
 * NOTE: uses relative imports (not the "@/" alias) so this module also works when
 * imported by tsx-run scripts (seed/migrate) that don't resolve tsconfig paths.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "../config";
import * as schema from "./schema";

// Reuse the pool across hot-reloads in dev to avoid exhausting connections.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
  });

if (config.NODE_ENV !== "production") globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });

export type DB = typeof db;
