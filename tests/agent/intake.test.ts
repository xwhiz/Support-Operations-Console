import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { and, eq, inArray } from "drizzle-orm";
import { makeTestDb, truncateAll } from "../helpers/db";
import { seedPaidOrder, insertCustomer, daysAgo } from "../helpers/fixtures";
import {
  refunds,
  cancellations,
  escalations,
  proposedActions,
  toolCalls,
  supportRequests,
} from "../../src/db/schema";
import { handleSupportRequest } from "../../src/services/intake";
import type { LlmClient, GenerateResult, ToolCall } from "../../src/agent/llm";

// A scripted LLM that returns queued turns in order (last turn repeats to end the loop).
function scripted(steps: GenerateResult[]): LlmClient {
  let i = 0;
  return {
    async generate() {
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      return step;
    },
  };
}
const call = (name: string, args: Record<string, unknown>): GenerateResult => ({
  text: "",
  toolCalls: [{ name, args } as ToolCall],
  usage: {},
});
const done = (text: string): GenerateResult => ({ text, toolCalls: [], usage: {} });

describe("intake — agent loop + policy + execution", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("AUTO: small refund executes and is fully traced", async () => {
    const { customer, order } = await seedPaidOrder(db, { total: "40.00" });
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "Please refund my order, it was defective.",
      dbc: db,
      llm: scripted([
        call("getOrder", { orderNumber: order.orderNumber }),
        call("proposeRefund", { orderNumber: order.orderNumber, amount: 40, reason: "defective" }),
        done("Your refund has been processed."),
      ]),
    });

    expect(res.decision).toBe("auto_resolved");
    expect(res.mode).toBe("AUTO");

    const active = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ["pending", "succeeded"])));
    expect(active).toHaveLength(1);

    const [sr] = await db.select().from(supportRequests).where(eq(supportRequests.id, res.supportRequestId));
    expect(sr.status).toBe("auto_resolved");

    const tcs = await db.select().from(toolCalls).where(eq(toolCalls.agentRunId, res.agentRunId));
    expect(tcs.length).toBeGreaterThanOrEqual(2); // getOrder + proposeRefund

    const [pa] = await db.select().from(proposedActions).where(eq(proposedActions.agentRunId, res.agentRunId));
    expect(pa.policyMode).toBe("AUTO");
    expect(pa.requiresHumanApproval).toBe(false);
  });

  it("ESCALATE: refund above the auto limit creates an escalation, no refund", async () => {
    const { customer, order } = await seedPaidOrder(db, { total: "120.00" });
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "Refund order please",
      dbc: db,
      llm: scripted([
        call("proposeRefund", { orderNumber: order.orderNumber, amount: 120, reason: "unhappy" }),
        done("A specialist will review this shortly."),
      ]),
    });
    expect(res.decision).toBe("escalated");
    expect(res.reasons).toContain("ABOVE_AUTO_LIMIT");
    expect(res.escalationId).toBeTruthy();

    const esc = await db.select().from(escalations).where(eq(escalations.supportRequestId, res.supportRequestId));
    expect(esc).toHaveLength(1);
    expect(esc[0].status).toBe("pending");
    const refs = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refs).toHaveLength(0);
  });

  it("ESCALATE: refund exceeding amount paid", async () => {
    const { customer, order } = await seedPaidOrder(db, { total: "40.00" });
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "Refund 100",
      dbc: db,
      llm: scripted([
        call("proposeRefund", { orderNumber: order.orderNumber, amount: 100, reason: "x" }),
        done("Reviewing."),
      ]),
    });
    expect(res.decision).toBe("escalated");
    expect(res.reasons).toContain("EXCEEDS_PAID");
  });

  it("REJECT: nothing refundable (already refunded)", async () => {
    const { customer, order, payment } = await seedPaidOrder(db, { total: "30.00" });
    await db.insert(refunds).values({
      orderId: order.id,
      paymentId: payment.id,
      amount: "30.00",
      status: "succeeded",
      idempotencyKey: `seed-${order.id}`,
      createdBy: "system",
    });
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "Another refund please",
      dbc: db,
      llm: scripted([
        call("proposeRefund", { orderNumber: order.orderNumber, amount: 10, reason: "again" }),
        done("Sorry, this order has already been refunded."),
      ]),
    });
    expect(res.decision).toBe("rejected");
    expect(res.reasons).toContain("NOTHING_REFUNDABLE");
    const active = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ["pending", "succeeded"])));
    expect(active).toHaveLength(1); // only the seeded one
  });

  it("REJECT: cancelling a shipped order", async () => {
    const { customer, order } = await seedPaidOrder(db, { status: "shipped", shippedAt: daysAgo(2) });
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "Cancel it, hasn't shipped",
      dbc: db,
      llm: scripted([
        call("proposeCancellation", { orderNumber: order.orderNumber, reason: "changed mind" }),
        done("Sorry, this order has already shipped."),
      ]),
    });
    expect(res.decision).toBe("rejected");
    expect(res.reasons).toContain("ALREADY_SHIPPED");
    const cancels = await db.select().from(cancellations).where(eq(cancellations.orderId, order.id));
    expect(cancels).toHaveLength(0);
  });

  it("AUTO: cancelling an unshipped, recent order", async () => {
    const { customer, order } = await seedPaidOrder(db, { status: "paid", shippedAt: null });
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "Cancel my order please",
      dbc: db,
      llm: scripted([
        call("proposeCancellation", { orderNumber: order.orderNumber, reason: "no longer needed" }),
        done("Your order has been cancelled."),
      ]),
    });
    expect(res.decision).toBe("auto_resolved");
    const cancels = await db.select().from(cancellations).where(eq(cancellations.orderId, order.id));
    expect(cancels).toHaveLength(1);
  });

  it("ESCALATE: a replacement is always human-reviewed", async () => {
    const { customer, order } = await seedPaidOrder(db, { status: "delivered", deliveredAt: daysAgo(3) });
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "It arrived damaged, send a replacement",
      dbc: db,
      llm: scripted([
        call("proposeReplacement", { orderNumber: order.orderNumber, reason: "damaged" }),
        done("A specialist will review your replacement request."),
      ]),
    });
    expect(res.decision).toBe("escalated");
    expect(res.reasons).toContain("REPLACEMENT_ALWAYS_REVIEWED");
  });

  it("REJECT: refund on someone else's order is auto-declined, never escalated", async () => {
    const { order } = await seedPaidOrder(db, { total: "40.00" }); // owned by customer A
    const attacker = await insertCustomer(db);
    const res = await handleSupportRequest({
      requesterCustomerId: attacker.id,
      rawText: `Refund order ${order.orderNumber}`,
      dbc: db,
      llm: scripted([
        call("proposeRefund", { orderNumber: order.orderNumber, amount: 40, reason: "mine" }),
        done("Reviewing."),
      ]),
    });
    expect(res.decision).toBe("rejected");
    expect(res.reasons).toContain("NOT_AUTHORIZED");
    // No refund and no human-approvable escalation on the other customer's order.
    const refs = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refs).toHaveLength(0);
    const escs = await db.select().from(escalations).where(eq(escalations.supportRequestId, res.supportRequestId));
    expect(escs).toHaveLength(0);
  });

  it("REJECT: hallucinated order id is auto-declined", async () => {
    const customer = await insertCustomer(db);
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "Refund order 999999",
      dbc: db,
      llm: scripted([
        call("proposeRefund", { orderNumber: 999999, amount: 10, reason: "?" }),
        done("Reviewing."),
      ]),
    });
    expect(res.decision).toBe("rejected");
    expect(res.reasons).toContain("ORDER_NOT_FOUND");
    const escs = await db.select().from(escalations).where(eq(escalations.supportRequestId, res.supportRequestId));
    expect(escs).toHaveLength(0);
  });

  it("ESCALATE: no proposal (model only chats) -> no_action escalation", async () => {
    const customer = await insertCustomer(db);
    const res = await handleSupportRequest({
      requesterCustomerId: customer.id,
      rawText: "hello?",
      dbc: db,
      llm: scripted([done("How can I help you today?")]),
    });
    expect(res.decision).toBe("escalated");
    expect(res.reasons).toContain("NO_ACTION");
  });
});
