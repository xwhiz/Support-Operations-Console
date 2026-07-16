import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import bcrypt from "bcryptjs";
import { makeTestDb, truncateAll } from "./helpers/db";
import { users } from "../src/db/schema";
import { authenticate } from "../src/lib/auth";

describe("authenticate", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
    const passwordHash = await bcrypt.hash("secret123", 10);
    await db.insert(users).values({
      email: "auth@test.local",
      name: "Auth User",
      passwordHash,
      role: "customer",
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns a session for correct credentials", async () => {
    const s = await authenticate("auth@test.local", "secret123", db);
    expect(s).not.toBeNull();
    expect(s?.role).toBe("customer");
    expect(s?.email).toBe("auth@test.local");
  });

  it("is case-insensitive on email", async () => {
    const s = await authenticate("AUTH@TEST.LOCAL", "secret123", db);
    expect(s).not.toBeNull();
  });

  it("rejects a wrong password", async () => {
    expect(await authenticate("auth@test.local", "nope", db)).toBeNull();
  });

  it("rejects an unknown email", async () => {
    expect(await authenticate("ghost@test.local", "secret123", db)).toBeNull();
  });
});
