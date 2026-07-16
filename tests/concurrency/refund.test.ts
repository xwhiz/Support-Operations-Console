import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { makeTestDb, truncateAll } from "../helpers/db";
import { seedPaidOrder, insertCustomer } from "../helpers/fixtures";
import { refunds, executionAttempts } from "../../src/db/schema";
import { executeRefund, type RefundCommand } from "../../src/services/guarded-executor";
import { ConflictError, GuardrailError } from "../../src/services/errors";

describe("guarded executor — refund", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  function cmd(orderId: string, over: Partial<RefundCommand> = {}): RefundCommand {
    return {
      actor: "system",
      initiatedVia: "auto",
      orderId,
      amount: "10.00",
      idempotencyKey: `k-${randomUUID()}`,
      ...over,
    };
  }

  it("DOUBLE-REFUND: N concurrent requests -> exactly one succeeds, rest 409, one active row", async () => {
    const { order } = await seedPaidOrder(db, { total: "100.00" });
    const N = 8;

    const results = await Promise.allSettled(
      Array.from({ length: N }, () => executeRefund(cmd(order.id, { amount: "50.00" }), db)),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const conflicts = results.filter(
      (r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof ConflictError,
    );
    expect(fulfilled).toHaveLength(1);
    expect(conflicts).toHaveLength(N - 1);

    // The refunds table shows exactly one active refund for the order.
    const active = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ["pending", "succeeded"])));
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("succeeded");

    // Traceability: one executed attempt + N-1 conflicts logged.
    const attempts = await db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.orderId, order.id));
    expect(attempts.filter((a) => a.outcome === "executed")).toHaveLength(1);
    expect(attempts.filter((a) => a.outcome === "conflict")).toHaveLength(N - 1);
  });

  it("rejects refund greater than amount paid (EXCEEDS_PAID)", async () => {
    const { order } = await seedPaidOrder(db, { total: "40.00" });
    await expect(executeRefund(cmd(order.id, { amount: "50.00" }), db)).rejects.toMatchObject({
      code: "EXCEEDS_PAID",
    });
  });

  it("rejects a refund on an already fully-refunded order (NOTHING_REFUNDABLE)", async () => {
    const { order } = await seedPaidOrder(db, { total: "30.00" });
    await executeRefund(cmd(order.id, { amount: "30.00" }), db); // full refund
    await expect(executeRefund(cmd(order.id, { amount: "5.00" }), db)).rejects.toMatchObject({
      code: "NOTHING_REFUNDABLE",
    });
  });

  it("rejects a refund on someone else's order (NOT_AUTHORIZED)", async () => {
    const { order } = await seedPaidOrder(db, { total: "100.00" });
    const other = await insertCustomer(db);
    await expect(
      executeRefund(cmd(order.id, { amount: "10.00", requesterCustomerId: other.id }), db),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("retrying the same order does not create a second refund", async () => {
    const { order } = await seedPaidOrder(db, { total: "100.00" });
    await executeRefund(cmd(order.id, { amount: "10.00" }), db);
    await expect(executeRefund(cmd(order.id, { amount: "10.00" }), db)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const active = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ["pending", "succeeded"])));
    expect(active).toHaveLength(1);
  });

  it("rejects a zero/negative amount (INVALID_AMOUNT)", async () => {
    const { order } = await seedPaidOrder(db, { total: "100.00" });
    await expect(executeRefund(cmd(order.id, { amount: "0.00" }), db)).rejects.toBeInstanceOf(
      GuardrailError,
    );
  });
});
