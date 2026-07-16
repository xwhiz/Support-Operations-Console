import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { makeTestDb, truncateAll } from "../helpers/db";
import { insertCustomer } from "../helpers/fixtures";
import { supportRequests } from "../../src/db/schema";
import { listCustomerRequests } from "../../src/services/escalation-reads";

describe("listCustomerRequests — own-data scoping", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("returns only the requesting customer's own requests", async () => {
    const a = await insertCustomer(db);
    const b = await insertCustomer(db);
    await db.insert(supportRequests).values([
      { requesterCustomerId: a.id, rawText: "a-one", status: "auto_resolved" },
      { requesterCustomerId: a.id, rawText: "a-two", status: "escalated" },
      { requesterCustomerId: b.id, rawText: "b-one", status: "rejected" },
    ]);

    const aReqs = await listCustomerRequests(a.id, db);
    expect(aReqs).toHaveLength(2);
    expect(aReqs.every((r) => r.message.startsWith("a-"))).toBe(true);

    const bReqs = await listCustomerRequests(b.id, db);
    expect(bReqs).toHaveLength(1);
    expect(bReqs[0].message).toBe("b-one");
  });
});
