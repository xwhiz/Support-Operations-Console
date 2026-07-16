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
import { CATALOG } from "../lib/catalog";
import { money, sumMoney, toDbAmount } from "../services/money";

/**
 * Seeds a demo dataset for the whole product.
 *
 * A fixed "anchor" matrix (Alice/Bob + orders 1001–1005 + two pending
 * escalations) exercises every guardrail / policy / concurrency path and keeps
 * the graded scenarios intact. On top of that we generate a richer, deterministic
 * population (more customers, orders across time, and support requests across
 * every status) so the dashboards, analytics, and customers/orders views look
 * real. All generated data respects the DB invariants: captured payments only
 * for paid+ statuses, one succeeded refund per refunded order, never a shipped
 * order marked cancelled, unique order numbers / idempotency keys.
 *
 * User ids are STABLE across re-seeds so existing session cookies keep working.
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

// Deterministic PRNG (mulberry32) — reproducible seed data, no dependency.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXTRA_CUSTOMERS = [
  "Olivia Rhye",
  "Phoenix Baker",
  "Lana Steiner",
  "Candice Wu",
];

function customerUuid(i: number): string {
  return `aaaaaaaa-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

export async function runSeed(db: DB): Promise<void> {
  const rand = mulberry32(20260716);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const randint = (min: number, max: number) =>
    min + Math.floor(rand() * (max - min + 1));
  const weighted = <T>(pairs: [T, number][]): T => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) if ((r -= w) < 0) return v;
    return pairs[0][0];
  };
  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
  const clampPast = (d: Date) =>
    new Date(Math.min(d.getTime(), Date.now() - 3600_000));

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await db.execute(
    sql.raw(
      `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
    ),
  );

  // --- Users -------------------------------------------------------------
  const [alice, bob, rae, sam] = await db
    .insert(users)
    .values([
      { id: IDS.alice, email: "alice@example.com", name: "Alice Customer", passwordHash, role: "customer" },
      { id: IDS.bob, email: "bob@example.com", name: "Bob Customer", passwordHash, role: "customer" },
      { id: IDS.rae, email: "rae@support.example.com", name: "Rae Reviewer", passwordHash, role: "reviewer" },
      { id: IDS.sam, email: "sam@support.example.com", name: "Sam Reviewer", passwordHash, role: "reviewer" },
    ])
    .returning();

  const extra = await db
    .insert(users)
    .values(
      EXTRA_CUSTOMERS.map((name, i) => ({
        id: customerUuid(i + 1),
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        name,
        passwordHash,
        role: "customer" as const,
      })),
    )
    .returning();

  const customers = [alice, bob, ...extra];
  const reviewers = [rae, sam];

  // --- Anchor orders (graded scenarios) ----------------------------------
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
  void o1001;

  // --- Anchor escalations (console is demoable immediately) ---------------
  async function seedEscalation(opts: {
    customerId: string;
    orderRow: typeof orders.$inferSelect;
    message: string;
    actionType: "refund" | "replacement";
    amount?: string;
    reasons: string[];
    summary: string;
    status?: "pending" | "executed" | "rejected";
    decidedBy?: string;
    note?: string;
    createdAt?: Date;
  }) {
    const createdAt = opts.createdAt ?? new Date();
    const [req] = await db
      .insert(supportRequests)
      .values({
        requesterCustomerId: opts.customerId,
        rawText: opts.message,
        status: "escalated",
        referencedOrderNumber: opts.orderRow.orderNumber,
        createdAt,
        updatedAt: createdAt,
      })
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
          confidence: 0.6 + rand() * 0.35,
        },
        policyMode: "ESCALATE",
        policyReasons: opts.reasons,
        requiresHumanApproval: true,
      })
      .returning();
    const status = opts.status ?? "pending";
    const decided = status !== "pending";
    await db.insert(escalations).values({
      supportRequestId: req.id,
      proposedActionId: pa.id,
      orderId: opts.orderRow.id,
      status,
      decision: decided ? (status === "executed" ? "approve" : "reject") : null,
      decisionNote: decided ? (opts.note ?? null) : null,
      decidedByReviewerId: decided ? (opts.decidedBy ?? rae.id) : null,
      decidedAt: decided ? clampPast(new Date(createdAt.getTime() + randint(1, 40) * 3600_000)) : null,
      createdAt,
    });
  }

  await seedEscalation({
    customerId: alice.id,
    orderRow: o1002.order,
    message: "Please refund order 1002, I am not satisfied with it.",
    actionType: "refund",
    amount: "120.00",
    reasons: ["ABOVE_AUTO_LIMIT"],
    summary: "Refund $120.00 for order #1002. Policy: ESCALATE (ABOVE_AUTO_LIMIT).",
  });
  await seedEscalation({
    customerId: alice.id,
    orderRow: o1004.order,
    message: "My order 1004 arrived damaged — please send a replacement.",
    actionType: "replacement",
    reasons: ["REPLACEMENT_ALWAYS_REVIEWED"],
    summary: "Ship a replacement for order #1004. Policy: ESCALATE (REPLACEMENT_ALWAYS_REVIEWED).",
  });
  // Two decided anchors so the customer always sees an approved + a declined
  // request (each with the reviewer's note), and the Approved/Rejected filters
  // are never empty.
  await seedEscalation({
    customerId: alice.id,
    orderRow: o1001.order,
    message: "Can I get a refund for order 1001? It wasn't quite what I expected.",
    actionType: "refund",
    amount: "40.00",
    reasons: ["ABOVE_AUTO_LIMIT"],
    summary: "Refund $40.00 for order #1001.",
    status: "executed",
    decidedBy: rae.id,
    note: "Verified the order and amount — refund approved.",
    createdAt: daysAgo(4),
  });
  await seedEscalation({
    customerId: alice.id,
    orderRow: o1003.order,
    message: "I'd like another refund on order 1003.",
    actionType: "refund",
    amount: "30.00",
    reasons: ["NOTHING_REFUNDABLE"],
    summary: "Refund $30.00 for order #1003.",
    status: "rejected",
    decidedBy: sam.id,
    note: "Order 1003 was already fully refunded, so no further refund can be issued.",
    createdAt: daysAgo(3),
  });

  // --- Generated population ----------------------------------------------
  const STATUS_WEIGHTS: [(typeof orders.$inferInsert)["status"], number][] = [
    ["delivered", 30],
    ["shipped", 14],
    ["paid", 15],
    ["processing", 9],
    ["pending", 12],
    ["cancelled", 8],
    ["refunded", 7],
    ["partially_refunded", 5],
  ];
  const PAID_STATES = new Set([
    "paid",
    "processing",
    "shipped",
    "delivered",
    "refunded",
    "partially_refunded",
  ]);

  const genOrders: { row: typeof orders.$inferSelect; customerId: string }[] = [];
  let orderNumber = 1006;
  const ORDER_COUNT = 12;

  for (let i = 0; i < ORDER_COUNT; i++) {
    const customer = pick(customers);
    const status = weighted(STATUS_WEIGHTS);
    const itemCount = randint(1, 3);
    const chosen = new Set<string>();
    const lines: (typeof orderItems.$inferInsert)[] = [];
    for (let k = 0; k < itemCount; k++) {
      const product = pick(CATALOG);
      if (chosen.has(product.sku)) continue;
      chosen.add(product.sku);
      const qty = randint(1, 3);
      lines.push({
        orderId: "", // set on insert below
        sku: product.sku,
        description: product.name,
        quantity: qty,
        unitPrice: product.unitPrice,
        lineTotal: toDbAmount(money(product.unitPrice).times(qty)),
      });
    }
    const total = toDbAmount(sumMoney(lines.map((l) => l.lineTotal as string)));
    const createdAt = daysAgo(randint(2, 90));

    let shippedAt: Date | null = null;
    let deliveredAt: Date | null = null;
    let cancelledAt: Date | null = null;
    if (status === "shipped")
      shippedAt = clampPast(new Date(createdAt.getTime() + randint(1, 3) * DAY));
    if (status === "delivered") {
      shippedAt = clampPast(new Date(createdAt.getTime() + randint(1, 3) * DAY));
      deliveredAt = clampPast(new Date(shippedAt.getTime() + randint(1, 4) * DAY));
    }
    if (status === "cancelled")
      cancelledAt = clampPast(new Date(createdAt.getTime() + randint(0, 2) * DAY));

    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: orderNumber++,
        customerId: customer.id,
        status,
        totalAmount: total,
        shippedAt,
        deliveredAt,
        cancelledAt,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    await db
      .insert(orderItems)
      .values(lines.map((l) => ({ ...l, orderId: order.id })));

    let payment: typeof payments.$inferSelect | null = null;
    if (PAID_STATES.has(status)) {
      [payment] = await db
        .insert(payments)
        .values({
          orderId: order.id,
          provider: "mock",
          providerChargeId: `ch_${order.orderNumber}`,
          amount: total,
          status: "captured",
          capturedAt: createdAt,
        })
        .returning();
    }
    if ((status === "refunded" || status === "partially_refunded") && payment) {
      const amount =
        status === "refunded"
          ? total
          : toDbAmount(money(total).times(0.5));
      if (money(amount).gt(0)) {
        await db.insert(refunds).values({
          orderId: order.id,
          paymentId: payment.id,
          amount,
          status: "succeeded",
          reason: "Seeded refund",
          idempotencyKey: `seed:refund:${order.orderNumber}`,
          externalRefundId: `re_seed_${order.orderNumber}`,
          createdBy: "system",
        });
      }
    }
    genOrders.push({ row: order, customerId: customer.id });
  }

  // --- Generated support requests + agent trace + escalations -------------
  const REQ_WEIGHTS: [
    "auto_resolved" | "escalated" | "rejected" | "received" | "processing" | "failed",
    number,
  ][] = [
    ["auto_resolved", 34],
    ["escalated", 30],
    ["rejected", 15],
    ["received", 8],
    ["processing", 7],
    ["failed", 6],
  ];
  const ACTIONS: ["refund" | "cancellation" | "replacement" | "escalate" | "no_action", number][] = [
    ["refund", 44],
    ["cancellation", 20],
    ["replacement", 18],
    ["escalate", 10],
    ["no_action", 8],
  ];
  const REASONS = [
    "ABOVE_AUTO_LIMIT",
    "EXCEEDS_PAID",
    "REPLACEMENT_ALWAYS_REVIEWED",
    "OUTSIDE_CANCEL_WINDOW",
    "AGENT_REQUESTED",
    "NOTHING_REFUNDABLE",
  ];
  const MESSAGES = [
    "I'd like a refund for this order.",
    "Please cancel my order, I changed my mind.",
    "The item arrived damaged — can I get a replacement?",
    "This is the wrong item, I need help.",
    "Where is my order? It's taking a while.",
    "Can you refund part of this? One item was missing.",
    "I was charged twice, please look into it.",
    "The product stopped working after a day.",
  ];

  const APPROVE_NOTES = [
    "Verified the order and amount — approved.",
    "Valid request, refund approved.",
    "Confirmed the order details; approved.",
  ];
  const REJECT_NOTES = [
    "Outside our refund window — unable to approve.",
    "Order was already resolved; no further action needed.",
    "Not enough detail to approve this request.",
    "This item isn't eligible for a refund.",
  ];
  const REQ_COUNT = 12;
  let escalatedCount = 0;
  for (let i = 0; i < REQ_COUNT; i++) {
    const target = pick(genOrders);
    const status = weighted(REQ_WEIGHTS);
    const createdAt = daysAgo(randint(0, 88));
    const actionType =
      status === "auto_resolved"
        ? (pick(["refund", "cancellation"]) as "refund" | "cancellation")
        : weighted(ACTIONS);
    const amount =
      actionType === "refund"
        ? toDbAmount(money(target.row.totalAmount).times(0.3 + rand() * 0.7))
        : null;

    const [req] = await db
      .insert(supportRequests)
      .values({
        requesterCustomerId: target.customerId,
        rawText: pick(MESSAGES),
        status,
        referencedOrderNumber: target.row.orderNumber,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    const policyMode =
      status === "auto_resolved"
        ? "AUTO"
        : status === "rejected"
          ? "REJECT"
          : status === "escalated"
            ? "ESCALATE"
            : null;

    const [run] = await db
      .insert(agentRuns)
      .values({
        supportRequestId: req.id,
        model: "seed",
        status: status === "failed" ? "failed" : "completed",
        finalDecision: policyMode,
        decisionSummary:
          policyMode === "AUTO"
            ? "Within auto-resolve limits."
            : policyMode === "REJECT"
              ? "Refused by policy."
              : policyMode === "ESCALATE"
                ? "Routed to a human reviewer."
                : null,
        finalMessage:
          status === "auto_resolved"
            ? "All done — your request has been resolved."
            : "Thanks — we're looking into it.",
      })
      .returning();

    const [pa] = await db
      .insert(proposedActions)
      .values({
        agentRunId: run.id,
        supportRequestId: req.id,
        actionType,
        targetOrderId: target.row.id,
        amount,
        payload: {
          type: actionType,
          orderNumber: target.row.orderNumber,
          amount: amount ?? undefined,
          currency: "USD",
          confidence: 0.5 + rand() * 0.45,
        },
        policyMode,
        policyReasons:
          policyMode === "ESCALATE" || policyMode === "REJECT"
            ? [pick(REASONS)]
            : [],
        requiresHumanApproval: status === "escalated",
      })
      .returning();

    if (status === "escalated") {
      escalatedCount++;
      const escState = weighted<"pending" | "executed" | "rejected">([
        ["pending", 42],
        ["executed", 34],
        ["rejected", 24],
      ]);
      const decided = escState !== "pending";
      await db.insert(escalations).values({
        supportRequestId: req.id,
        proposedActionId: pa.id,
        orderId: target.row.id,
        status: escState,
        decision: decided ? (escState === "executed" ? "approve" : "reject") : null,
        decisionNote: decided
          ? escState === "executed"
            ? pick(APPROVE_NOTES)
            : pick(REJECT_NOTES)
          : null,
        decidedByReviewerId: decided ? pick(reviewers).id : null,
        decidedAt: decided
          ? clampPast(new Date(createdAt.getTime() + randint(1, 48) * 3600_000))
          : null,
        createdAt,
      });
    }
  }

  console.log("Seed complete.");
  console.log(`  Customers: ${customers.length} (alice@example.com … + ${extra.length} more)`);
  console.log(`  Reviewers: rae@support.example.com, sam@support.example.com`);
  console.log(`  Password (all): ${DEMO_PASSWORD}`);
  console.log(`  Orders: ${5 + genOrders.length} (1001–${orderNumber - 1})`);
  console.log(`  Support requests: ${REQ_COUNT + 4} (+4 anchor escalations, ${escalatedCount} generated escalations)`);
}
