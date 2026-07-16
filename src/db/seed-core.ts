import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import type { DB } from "./client";
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
 * Seeds a fixed matrix of users + orders that exercises every guardrail / policy
 * / concurrency path, plus two pending escalations so the console is demoable.
 *
 * User ids are STABLE across re-seeds so an existing session cookie (which stores
 * the user id) keeps working after a re-seed — otherwise approving/submitting
 * would hit a foreign-key error on a now-deleted user.
 *
 * Order matrix (all Alice's unless noted):
 *   1001 paid, NOT shipped, $40   -> auto refund + auto cancel (under $50 limit)
 *   1002 shipped 5d ago, $120     -> cancel REJECTED; refund > $50 -> escalate
 *   1003 refunded, $30 (+refund)  -> 2nd refund REJECTED (nothing refundable)
 *   1004 delivered 3d ago, $80    -> replacement (damaged) -> always escalate
 *   1005 Bob's, paid, $25         -> authorization test (Alice references Bob's order)
 */
export const DEMO_PASSWORD = "password123";

const IDS = {
  alice: "11111111-1111-4111-8111-111111111111",
  bob: "22222222-2222-4222-8222-222222222222",
  rae: "33333333-3333-4333-8333-333333333333",
  sam: "44444444-4444-4444-8444-444444444444",
} as const;

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

export async function runSeed(db: DB): Promise<void> {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await db.execute(
    sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`),
  );

  const [alice, bob] = await db
    .insert(users)
    .values([
      { id: IDS.alice, email: "alice@example.com", name: "Alice Customer", passwordHash, role: "customer" },
      { id: IDS.bob, email: "bob@example.com", name: "Bob Customer", passwordHash, role: "customer" },
      { id: IDS.rae, email: "rae@support.example.com", name: "Rae Reviewer", passwordHash, role: "reviewer" },
      { id: IDS.sam, email: "sam@support.example.com", name: "Sam Reviewer", passwordHash, role: "reviewer" },
    ])
    .returning();

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

  const o1001 = await makeOrder({ orderNumber: 1001, customerId: alice.id, status: "paid", total: "40.00", sku: "SKU-WIDGET", description: "Blue Widget" });
  const o1002 = await makeOrder({ orderNumber: 1002, customerId: alice.id, status: "shipped", total: "120.00", sku: "SKU-GADGET", description: "Deluxe Gadget", shippedAt: daysAgo(5) });
  const o1003 = await makeOrder({ orderNumber: 1003, customerId: alice.id, status: "refunded", total: "30.00", sku: "SKU-GIZMO", description: "Small Gizmo", shippedAt: daysAgo(12), deliveredAt: daysAgo(10) });
  const o1004 = await makeOrder({ orderNumber: 1004, customerId: alice.id, status: "delivered", total: "80.00", sku: "SKU-LAMP", description: "Desk Lamp", shippedAt: daysAgo(6), deliveredAt: daysAgo(3) });
  await makeOrder({ orderNumber: 1005, customerId: bob.id, status: "paid", total: "25.00", sku: "SKU-CABLE", description: "USB Cable" });

  // Order 1003 already fully refunded -> a second refund must be refused.
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
        payload: { type: opts.actionType, orderNumber: opts.orderRow.orderNumber, amount: opts.amount, currency: "USD", rationale: opts.summary },
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
    summary: "Refund $120.00 for order #1002. Policy: ESCALATE (ABOVE_AUTO_LIMIT). Amount exceeds the auto-approve limit.",
  });
  await seedEscalation({
    orderRow: o1004.order,
    message: "My order 1004 arrived damaged — please send a replacement.",
    actionType: "replacement",
    reasons: ["REPLACEMENT_ALWAYS_REVIEWED"],
    summary: "Ship a replacement for order #1004. Policy: ESCALATE (REPLACEMENT_ALWAYS_REVIEWED). Replacements are always human-reviewed.",
  });

  void o1001;

  console.log("Seed complete.");
  console.log(`  Customers: alice@example.com, bob@example.com`);
  console.log(`  Reviewers: rae@support.example.com, sam@support.example.com`);
  console.log(`  Password (all): ${DEMO_PASSWORD}`);
  console.log(`  Orders: 1001 (auto), 1002 (shipped), 1003 (refunded), 1004 (delivered), 1005 (Bob's)`);
  console.log(`  Pending escalations: refund #1002, replacement #1004`);
}
