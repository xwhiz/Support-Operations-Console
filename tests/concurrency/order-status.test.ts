import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, truncateAll } from "../helpers/db";
import { insertCustomer, insertOrder } from "../helpers/fixtures";
import { updateOrderStatus } from "../../src/services/orders";
import { orders } from "../../src/db/schema";

const { db, pool } = makeTestDb();

beforeEach(() => truncateAll(pool));
afterAll(() => pool.end());

describe("concurrent order status updates", () => {
  it("applies exactly once under a version race", async () => {
    const c = await insertCustomer(db);
    const o = await insertOrder(db, { customerId: c.id, status: "pending" });

    const N = 6;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        updateOrderStatus(
          { orderId: o.id, targetStatus: "paid", expectedVersion: 0, reviewerId: "r" },
          db,
        ),
      ),
    );

    const won = results.filter((r) => r.status === "fulfilled").length;
    expect(won).toBe(1);

    const [after] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(after.status).toBe("paid");
    expect(after.version).toBe(1); // a single applied increment, not N
  });
});
