import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { makeTestDb, truncateAll } from "../helpers/db";
import { seedPaidOrder, insertCustomer } from "../helpers/fixtures";
import { cancellations, orders } from "../../src/db/schema";
import {
  executeCancellation,
  type CancellationCommand,
} from "../../src/services/guarded-executor";
import { ConflictError } from "../../src/services/errors";

describe("guarded executor — cancellation", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  function cmd(orderId: string, over: Partial<CancellationCommand> = {}): CancellationCommand {
    return {
      actor: "system",
      initiatedVia: "auto",
      orderId,
      idempotencyKey: `k-${randomUUID()}`,
      ...over,
    };
  }

  it("DOUBLE-CANCEL: N concurrent -> exactly one succeeds, rest 409, one row, order cancelled", async () => {
    const { order } = await seedPaidOrder(db, { status: "paid", shippedAt: null });
    const N = 8;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => executeCancellation(cmd(order.id), db)),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const conflicts = results.filter(
      (r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof ConflictError,
    );
    expect(fulfilled).toHaveLength(1);
    expect(conflicts).toHaveLength(N - 1);

    const active = await db
      .select()
      .from(cancellations)
      .where(and(eq(cancellations.orderId, order.id), inArray(cancellations.status, ["pending", "succeeded"])));
    expect(active).toHaveLength(1);

    const [refreshed] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(refreshed.status).toBe("cancelled");
  });

  it("rejects cancelling a shipped order (ALREADY_SHIPPED)", async () => {
    const { order } = await seedPaidOrder(db, { status: "shipped", shippedAt: new Date() });
    await expect(executeCancellation(cmd(order.id), db)).rejects.toMatchObject({
      code: "ALREADY_SHIPPED",
    });
  });

  it("rejects cancelling someone else's order (NOT_AUTHORIZED)", async () => {
    const { order } = await seedPaidOrder(db, { status: "paid" });
    const other = await insertCustomer(db);
    await expect(
      executeCancellation(cmd(order.id, { requesterCustomerId: other.id }), db),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});
