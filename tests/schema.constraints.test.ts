import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { makeTestDb, truncateAll, pgError } from "./helpers/db";
import { users, orders, payments, refunds, cancellations } from "../src/db/schema";

/**
 * These prove the DB-level backstops exist and fire — independent of any
 * application code. They are the last line of defense for the guardrails.
 */
describe("DB constraints (backstops)", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;
  let customerId: string;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
    const [c] = await db
      .insert(users)
      .values({ email: "c@test.local", name: "C", passwordHash: "x", role: "customer" })
      .returning();
    customerId = c.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeOrder(orderNumber: number, opts: { status?: "paid" | "shipped"; shippedAt?: Date | null } = {}) {
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber,
        customerId,
        status: opts.status ?? "paid",
        totalAmount: "100.00",
        shippedAt: opts.shippedAt ?? null,
      })
      .returning();
    const [payment] = await db
      .insert(payments)
      .values({ orderId: order.id, amount: "100.00", status: "captured", providerChargeId: `ch_${orderNumber}` })
      .returning();
    return { order, payment };
  }

  it("rejects a refund with amount <= 0 (CHECK refunds_amount_positive)", async () => {
    const { order, payment } = await makeOrder(9001);
    let err: ReturnType<typeof pgError> | undefined;
    try {
      await db.insert(refunds).values({
        orderId: order.id,
        paymentId: payment.id,
        amount: "0.00",
        status: "pending",
        idempotencyKey: "amt-zero",
        createdBy: "test",
      });
    } catch (e) {
      err = pgError(e);
    }
    expect(err?.code).toBe("23514"); // check_violation
  });

  it("rejects a SECOND active refund on the same order (uniq_active_refund_per_order)", async () => {
    const { order, payment } = await makeOrder(9002);
    await db.insert(refunds).values({
      orderId: order.id,
      paymentId: payment.id,
      amount: "10.00",
      status: "pending",
      idempotencyKey: "dup-1",
      createdBy: "test",
    });
    let err: ReturnType<typeof pgError> | undefined;
    try {
      await db.insert(refunds).values({
        orderId: order.id,
        paymentId: payment.id,
        amount: "10.00",
        status: "pending",
        idempotencyKey: "dup-2",
        createdBy: "test",
      });
    } catch (e) {
      err = pgError(e);
    }
    expect(err?.code).toBe("23505"); // unique_violation
  });

  it("allows a new refund after a FAILED one (partial index only blocks active)", async () => {
    const { order, payment } = await makeOrder(9003);
    await db.insert(refunds).values({
      orderId: order.id,
      paymentId: payment.id,
      amount: "10.00",
      status: "failed",
      idempotencyKey: "failed-1",
      createdBy: "test",
    });
    const ok = await db
      .insert(refunds)
      .values({
        orderId: order.id,
        paymentId: payment.id,
        amount: "10.00",
        status: "pending",
        idempotencyKey: "after-failed",
        createdBy: "test",
      })
      .returning();
    expect(ok).toHaveLength(1);
  });

  it("rejects a duplicate idempotency_key (refunds_idempotency_key_unique)", async () => {
    const { order, payment } = await makeOrder(9004);
    await db.insert(refunds).values({
      orderId: order.id,
      paymentId: payment.id,
      amount: "10.00",
      status: "failed",
      idempotencyKey: "idem-shared",
      createdBy: "test",
    });
    let err: ReturnType<typeof pgError> | undefined;
    try {
      await db.insert(refunds).values({
        orderId: order.id,
        paymentId: payment.id,
        amount: "10.00",
        status: "failed",
        idempotencyKey: "idem-shared",
        createdBy: "test",
      });
    } catch (e) {
      err = pgError(e);
    }
    expect(err?.code).toBe("23505");
  });

  it("rejects cancelling a SHIPPED order (trg_cancellation_not_shipped)", async () => {
    const { order } = await makeOrder(9005, { status: "shipped", shippedAt: new Date() });
    let err: ReturnType<typeof pgError> | undefined;
    try {
      await db.insert(cancellations).values({
        orderId: order.id,
        status: "pending",
        idempotencyKey: "cancel-shipped",
        createdBy: "test",
      });
    } catch (e) {
      err = pgError(e);
    }
    expect(err?.code).toBe("23514"); // raised with ERRCODE check_violation
    expect(err?.message).toMatch(/already shipped/);
  });

  it("allows cancelling an UNSHIPPED order", async () => {
    const { order } = await makeOrder(9006, { status: "paid", shippedAt: null });
    const ok = await db
      .insert(cancellations)
      .values({
        orderId: order.id,
        status: "pending",
        idempotencyKey: "cancel-ok",
        createdBy: "test",
      })
      .returning();
    expect(ok).toHaveLength(1);
  });
});
