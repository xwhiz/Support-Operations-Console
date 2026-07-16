/**
 * Full Postgres schema (Drizzle).
 *
 * Money is numeric(14,2) and surfaces as a string in TS (wrapped in decimal.js by
 * the money layer) — never a float. Statuses use pgEnums. The two load-bearing
 * DB-level guarantees live here:
 *   - `uniq_active_refund_per_order` partial unique index  -> no double refund
 *   - `uniq_active_cancellation/replacement_per_order`      -> no double cancel/replace
 * The "no cancel if shipped" trigger and the escalations pg_notify trigger are added
 * in the custom migration (drizzle/0001_triggers.sql) since Drizzle can't model them.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  numeric,
  jsonb,
  char,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum("role", ["customer", "reviewer", "admin"]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "authorized",
  "captured",
  "refunded",
  "partially_refunded",
  "voided",
]);
export const refundStatusEnum = pgEnum("refund_status", [
  "pending",
  "succeeded",
  "failed",
  "voided",
]);
export const cancellationStatusEnum = pgEnum("cancellation_status", [
  "pending",
  "succeeded",
  "failed",
]);
export const replacementStatusEnum = pgEnum("replacement_status", [
  "pending",
  "succeeded",
  "failed",
]);
export const requestStatusEnum = pgEnum("request_status", [
  "received",
  "processing",
  "auto_resolved",
  "escalated",
  "rejected",
  "failed",
]);
export const runStatusEnum = pgEnum("run_status", [
  "running",
  "completed",
  "failed",
]);
export const escalationStatusEnum = pgEnum("escalation_status", [
  "pending",
  "approved",
  "rejected",
  "executed",
  "execution_failed",
]);
export const decisionEnum = pgEnum("decision", ["approve", "reject"]);
export const policyModeEnum = pgEnum("policy_mode", [
  "AUTO",
  "ESCALATE",
  "REJECT",
]);
export const executionOutcomeEnum = pgEnum("execution_outcome", [
  "executed",
  "rejected_guardrail",
  "conflict",
  "error",
]);
export const initiatedViaEnum = pgEnum("initiated_via", [
  "auto",
  "human_approval",
]);
export const actionTypeEnum = pgEnum("action_type", [
  "refund",
  "cancellation",
  "replacement",
  "escalate",
  "no_action",
]);

/** The structured proposal the agent emits and the UI/executor both read. */
export type ProposedActionPayload = {
  type: "refund" | "cancellation" | "replacement" | "escalate" | "no_action";
  orderNumber?: number;
  amount?: string; // decimal string, e.g. "49.99"
  currency?: string;
  itemSku?: string;
  rationale?: string;
  humanSummary?: string;
  /** Model self-reported confidence. ADVISORY DISPLAY ONLY — never a guardrail/policy input. */
  confidence?: number;
};

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Business / reference
// ---------------------------------------------------------------------------
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: bigint("order_number", { mode: "number" }).notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    status: orderStatusEnum("status").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_orders_customer").on(t.customerId),
    check("orders_total_nonneg", sql`${t.totalAmount} >= 0`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    sku: text("sku").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [
    index("idx_order_items_order").on(t.orderId),
    check("order_items_qty_positive", sql`${t.quantity} > 0`),
    check("order_items_prices_nonneg", sql`${t.unitPrice} >= 0 AND ${t.lineTotal} >= 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull().default("mock"),
    providerChargeId: text("provider_charge_id").unique(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    status: paymentStatusEnum("status").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_payments_order").on(t.orderId),
    check("payments_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Request + agent trace
// ---------------------------------------------------------------------------
export const supportRequests = pgTable("support_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterCustomerId: uuid("requester_customer_id")
    .notNull()
    .references(() => users.id),
  rawText: text("raw_text").notNull(),
  channel: text("channel").notNull().default("chat"),
  referencedOrderNumber: bigint("referenced_order_number", { mode: "number" }),
  status: requestStatusEnum("status").notNull().default("received"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  supportRequestId: uuid("support_request_id")
    .notNull()
    .references(() => supportRequests.id),
  model: text("model").notNull(),
  status: runStatusEnum("status").notNull().default("running"),
  stopReason: text("stop_reason"),
  iterations: integer("iterations").notNull().default(0),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  finalDecision: text("final_decision"),
  /** Concise structured "why" for reviewers. NO chain-of-thought is stored. */
  decisionSummary: text("decision_summary"),
  /** Customer-facing natural-language explanation. */
  finalMessage: text("final_message"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("uniq_agent_messages_run_seq").on(t.agentRunId, t.seq)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id),
    seq: integer("seq").notNull(),
    toolName: text("tool_name").notNull(),
    toolUseId: text("tool_use_id").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    isError: boolean("is_error").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uniq_tool_calls_run_use").on(t.agentRunId, t.toolUseId),
    index("idx_tool_calls_run").on(t.agentRunId),
  ],
);

export const proposedActions = pgTable("proposed_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentRunId: uuid("agent_run_id")
    .notNull()
    .references(() => agentRuns.id),
  supportRequestId: uuid("support_request_id")
    .notNull()
    .references(() => supportRequests.id),
  actionType: actionTypeEnum("action_type").notNull(),
  targetOrderId: uuid("target_order_id").references(() => orders.id),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  payload: jsonb("payload").$type<ProposedActionPayload>().notNull(),
  policyMode: policyModeEnum("policy_mode"),
  policyReasons: jsonb("policy_reasons").$type<string[]>(),
  requiresHumanApproval: boolean("requires_human_approval")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Escalations (reviewer decision + concurrency version)
// Declared before the action tables; forward refs to them use lazy callbacks.
// ---------------------------------------------------------------------------
export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supportRequestId: uuid("support_request_id")
      .notNull()
      .references(() => supportRequests.id),
    proposedActionId: uuid("proposed_action_id")
      .notNull()
      .references(() => proposedActions.id),
    // Nullable: hallucinated/ambiguous requests escalate with no resolved order.
    orderId: uuid("order_id").references(() => orders.id),
    status: escalationStatusEnum("status").notNull().default("pending"),
    version: integer("version").notNull().default(0),
    decidedByReviewerId: uuid("decided_by_reviewer_id").references(
      () => users.id,
    ),
    decision: decisionEnum("decision"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    resultingRefundId: uuid("resulting_refund_id").references(
      (): any => refunds.id,
    ),
    resultingCancellationId: uuid("resulting_cancellation_id").references(
      (): any => cancellations.id,
    ),
    resultingReplacementId: uuid("resulting_replacement_id").references(
      (): any => replacements.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_escalations_pending")
      .on(t.status)
      .where(sql`${t.status} = 'pending'`),
    index("idx_escalations_request").on(t.supportRequestId),
  ],
);

// ---------------------------------------------------------------------------
// Action tables (concurrency-critical)
// ---------------------------------------------------------------------------
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    status: refundStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    externalRefundId: text("external_refund_id").unique(),
    createdBy: text("created_by").notNull(),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
    escalationId: uuid("escalation_id").references(() => escalations.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // THE double-refund guarantee: at most one active refund per order.
    uniqueIndex("uniq_active_refund_per_order")
      .on(t.orderId)
      .where(sql`${t.status} IN ('pending','succeeded')`),
    check("refunds_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const cancellations = pgTable(
  "cancellations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    status: cancellationStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdBy: text("created_by").notNull(),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
    escalationId: uuid("escalation_id").references(() => escalations.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_active_cancellation_per_order")
      .on(t.orderId)
      .where(sql`${t.status} IN ('pending','succeeded')`),
  ],
);

export const replacements = pgTable(
  "replacements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    itemSku: text("item_sku"),
    status: replacementStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdBy: text("created_by").notNull(),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
    escalationId: uuid("escalation_id").references(() => escalations.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_active_replacement_per_order")
      .on(t.orderId)
      .where(sql`${t.status} IN ('pending','succeeded')`),
  ],
);

// ---------------------------------------------------------------------------
// Audit: every execution attempt, including guardrail rejections + lost races.
// ---------------------------------------------------------------------------
export const executionAttempts = pgTable("execution_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionType: actionTypeEnum("action_type").notNull(),
  orderId: uuid("order_id").references(() => orders.id),
  initiatedVia: initiatedViaEnum("initiated_via").notNull(),
  escalationId: uuid("escalation_id").references(() => escalations.id),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  outcome: executionOutcomeEnum("outcome").notNull(),
  guardrailViolation: text("guardrail_violation"),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
