import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool, db } from "./client";
import {
  users,
  orders,
  orderItems,
  payments,
  refunds,
  supportRequests,
  agentRuns,
  proposedActions,
  escalations,
} from "./schema";

/**
 * Idempotent seed: truncates all domain tables, then inserts a fixed matrix of
 * users + orders chosen to exercise every guardrail / policy / concurrency path.
 *
 * Order matrix (all Alice's unless noted):
 *   1001 paid, NOT shipped, $40   -> auto refund + auto cancel (under $50 limit)
 *   1002 shipped 5d ago, $120     -> cancel REJECTED (shipped); refund > $50 -> escalate
 *   1003 refunded, $30 (+refund)  -> 2nd refund REJECTED (nothing refundable)
 *   1004 delivered 3d ago, $80    -> replacement (damaged) -> always escalate
 *   1005 Bob's, paid, $25         -> authorization test (Alice references Bob's order)
 */
const DEMO_PASSWORD = "password123";

const TABLES = [
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

async function main() {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await pool.query(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );

  const [alice, bob, rae, sam] = await db
    .insert(users)
    .values([
      { email: "alice@example.com", name: "Alice Customer", passwordHash, role: "customer" },
      { email: "bob@example.com", name: "Bob Customer", passwordHash, role: "customer" },
      { email: "rae@support.example.com", name: "Rae Reviewer", passwordHash, role: "reviewer" },
      { email: "sam@support.example.com", name: "Sam Reviewer", passwordHash, role: "reviewer" },
    ])
    .returning();

  // Helper to insert an order + its single line item + a captured payment.
  async function makeOrder(opts: {
    orderNumber: number;
    customerId: string;
    status: (typeof orders.$inferInsert)["status"];
    total: string;
    sku: string;
    description: string;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
  }) {
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: opts.orderNumber,
        customerId: opts.customerId,
        status: opts.status,
        totalAmount: opts.total,
        shippedAt: opts.shippedAt ?? null,
        deliveredAt: opts.deliveredAt ?? null,
      })
      .returning();

    await db.insert(orderItems).values({
      orderId: order.id,
      sku: opts.sku,
      description: opts.description,
      quantity: 1,
      unitPrice: opts.total,
      lineTotal: opts.total,
    });

    const [payment] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: "mock",
        providerChargeId: `ch_${opts.orderNumber}`,
        amount: opts.total,
        status: "captured",
        capturedAt: daysAgo(7),
      })
      .returning();

    return { order, payment };
  }

  const o1001 = await makeOrder({
    orderNumber: 1001,
    customerId: alice.id,
    status: "paid",
    total: "40.00",
    sku: "SKU-WIDGET",
    description: "Blue Widget",
  });

  const o1002 = await makeOrder({
    orderNumber: 1002,
    customerId: alice.id,
    status: "shipped",
    total: "120.00",
    sku: "SKU-GADGET",
    description: "Deluxe Gadget",
    shippedAt: daysAgo(5),
  });

  const o1003 = await makeOrder({
    orderNumber: 1003,
    customerId: alice.id,
    status: "refunded",
    total: "30.00",
    sku: "SKU-GIZMO",
    description: "Small Gizmo",
    deliveredAt: daysAgo(10),
  });

  const o1004 = await makeOrder({
    orderNumber: 1004,
    customerId: alice.id,
    status: "delivered",
    total: "80.00",
    sku: "SKU-LAMP",
    description: "Desk Lamp",
    deliveredAt: daysAgo(3),
  });

  await makeOrder({
    orderNumber: 1005,
    customerId: bob.id,
    status: "paid",
    total: "25.00",
    sku: "SKU-CABLE",
    description: "USB Cable",
  });

  // Order 1003 already has a completed refund -> a second refund must be refused.
  await db.insert(refunds).values({
    orderId: o1003.order.id,
    paymentId: o1003.payment.id,
    amount: "30.00",
    status: "succeeded",
    reason: "Pre-existing full refund (seed)",
    idempotencyKey: "seed:refund:1003",
    externalRefundId: "re_seed_1003",
    createdBy: "system",
  });

  // Two pending escalations so the reviewer console is demoable out-of-the-box
  // (and reviewable even without a live LLM key). Mirrors what the agent produces.
  async function seedEscalation(opts: {
    orderRow: typeof orders.$inferSelect;
    message: string;
    actionType: "refund" | "replacement";
    amount?: string;
    reasons: string[];
    summary: string;
  }) {
    const [req] = await db
      .insert(supportRequests)
      .values({ requesterCustomerId: alice.id, rawText: opts.message, status: "escalated" })
      .returning();
    const [run] = await db
      .insert(agentRuns)
      .values({
        supportRequestId: req.id,
        model: "seed",
        status: "completed",
        finalDecision: "ESCALATE",
        decisionSummary: opts.summary,
        finalMessage: "Thanks — a specialist will review your request shortly.",
      })
      .returning();
    const [pa] = await db
      .insert(proposedActions)
      .values({
        agentRunId: run.id,
        supportRequestId: req.id,
        actionType: opts.actionType,
        targetOrderId: opts.orderRow.id,
        amount: opts.amount ?? null,
        payload: {
          type: opts.actionType,
          orderNumber: opts.orderRow.orderNumber,
          amount: opts.amount,
          currency: "USD",
          rationale: opts.summary,
        },
        policyMode: "ESCALATE",
        policyReasons: opts.reasons,
        requiresHumanApproval: true,
      })
      .returning();
    await db.insert(escalations).values({
      supportRequestId: req.id,
      proposedActionId: pa.id,
      orderId: opts.orderRow.id,
      status: "pending",
    });
  }

  await seedEscalation({
    orderRow: o1002.order,
    message: "Please refund order 1002, I am not satisfied with it.",
    actionType: "refund",
    amount: "120.00",
    reasons: ["ABOVE_AUTO_LIMIT"],
    summary:
      "Refund $120.00 for order #1002. Policy: ESCALATE (ABOVE_AUTO_LIMIT). Amount exceeds the auto-approve limit.",
  });
  await seedEscalation({
    orderRow: o1004.order,
    message: "My order 1004 arrived damaged — please send a replacement.",
    actionType: "replacement",
    reasons: ["REPLACEMENT_ALWAYS_REVIEWED"],
    summary:
      "Ship a replacement for order #1004. Policy: ESCALATE (REPLACEMENT_ALWAYS_REVIEWED). Replacements are always human-reviewed.",
  });

  void o1001;
  void rae;
  void sam;

  console.log("Seed complete.");
  console.log(`  Customers: alice@example.com, bob@example.com`);
  console.log(`  Reviewers: rae@support.example.com, sam@support.example.com`);
  console.log(`  Password (all): ${DEMO_PASSWORD}`);
  console.log(`  Orders: 1001 (auto), 1002 (shipped), 1003 (refunded), 1004 (delivered), 1005 (Bob's)`);
  console.log(`  Pending escalations seeded: refund #1002, replacement #1004`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
