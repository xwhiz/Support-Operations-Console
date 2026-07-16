/**
 * THE GUARDED EXECUTOR — the only code path that mutates money/order state.
 * Every path (agent auto-execute AND human approval) goes through here.
 *
 * Each action, inside ONE transaction:
 *   1. SELECT ... FOR UPDATE on the order  -> serializes concurrent attempts
 *   2. guardrail checks read UNDER the lock -> race-free
 *   3. INSERT claims the partial-unique-index slot (double-action backstop)
 *   4. conditional UPDATE ... WHERE version=? (optimistic CAS) -> exactly-once
 * The refund's external "provider" call happens OUTSIDE the txn, keyed by an
 * idempotency key (never hold a row lock across an external call).
 *
 * The guardrails here fire regardless of what the LLM proposed or a human
 * approved — this is the last line of defense.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db as appDb, type DB } from "../db/client";
import {
  orders,
  payments,
  refunds,
  cancellations,
  replacements,
  executionAttempts,
} from "../db/schema";
import { config } from "../config";
import { money, sumMoney, toDbAmount } from "./money";
import {
  GuardrailError,
  ConflictError,
  isUniqueViolation,
  isCheckViolation,
} from "./errors";

type Txn = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type ExecutorContext = {
  /** Free-form actor label stored on the action row: 'agent' | 'reviewer:<id>' | 'system'. */
  actor: string;
  initiatedVia: "auto" | "human_approval";
  /** Authorization anchor. If set, the order MUST belong to this customer. */
  requesterCustomerId?: string | null;
  agentRunId?: string | null;
  escalationId?: string | null;
  reviewerId?: string | null;
};

export type RefundCommand = ExecutorContext & {
  orderId: string;
  amount: string;
  reason?: string;
  idempotencyKey: string;
};
export type CancellationCommand = ExecutorContext & {
  orderId: string;
  reason?: string;
  idempotencyKey: string;
};
export type ReplacementCommand = ExecutorContext & {
  orderId: string;
  itemSku?: string;
  reason?: string;
  idempotencyKey: string;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
async function lockOrder(tx: Txn, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update");
  if (!order) throw new GuardrailError("ORDER_NOT_FOUND");
  return order;
}

function assertOwnership(
  order: { customerId: string },
  requesterCustomerId?: string | null,
) {
  if (requesterCustomerId && order.customerId !== requesterCustomerId) {
    throw new GuardrailError("NOT_AUTHORIZED");
  }
}

type AttemptOutcome = "executed" | "rejected_guardrail" | "conflict" | "error";

export function classify(e: unknown): { outcome: AttemptOutcome; violation?: string } {
  if (e instanceof GuardrailError) return { outcome: "rejected_guardrail", violation: e.code };
  if (e instanceof ConflictError) return { outcome: "conflict", violation: e.code };
  return { outcome: "error", violation: e instanceof Error ? e.message : String(e) };
}

export async function logAttempt(
  dbc: DB,
  actionType: "refund" | "cancellation" | "replacement",
  ctx: ExecutorContext,
  orderId: string | null,
  outcome: AttemptOutcome,
  violation?: string,
  detail?: unknown,
) {
  await dbc.insert(executionAttempts).values({
    actionType,
    orderId,
    initiatedVia: ctx.initiatedVia,
    escalationId: ctx.escalationId ?? null,
    agentRunId: ctx.agentRunId ?? null,
    reviewerId: ctx.reviewerId ?? null,
    outcome,
    guardrailViolation: violation ?? null,
    detail: detail === undefined ? null : (detail as object),
  });
}

// ---------------------------------------------------------------------------
// REFUND
// ---------------------------------------------------------------------------
/**
 * Core refund logic within a caller-provided transaction. Inserts the refund as
 * 'pending' and flips the order status via a version CAS. Provider settlement is
 * done afterwards by settleRefund (outside the txn).
 * Guardrails: NOT_AUTHORIZED, NOTHING_REFUNDABLE (incl. already refunded),
 * EXCEEDS_PAID (refund must not exceed amount paid).
 */
export async function executeRefundWithinTx(tx: Txn, cmd: RefundCommand) {
  const order = await lockOrder(tx, cmd.orderId);
  assertOwnership(order, cmd.requesterCustomerId);

  const capturedPayments = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, cmd.orderId), eq(payments.status, "captured")));
  const payment = capturedPayments[0];
  if (!payment) throw new GuardrailError("PAYMENT_NOT_FOUND");
  const capturedTotal = sumMoney(capturedPayments.map((p) => p.amount));

  const activeRefunds = await tx
    .select()
    .from(refunds)
    .where(
      and(eq(refunds.orderId, cmd.orderId), inArray(refunds.status, ["pending", "succeeded"])),
    );
  const refundedTotal = sumMoney(activeRefunds.map((r) => r.amount));

  const amount = money(cmd.amount);
  if (amount.lte(0)) throw new GuardrailError("INVALID_AMOUNT"); // Rule: amount must be positive
  const remaining = capturedTotal.minus(refundedTotal);
  if (remaining.lte(0)) throw new GuardrailError("NOTHING_REFUNDABLE"); // Rule: already refunded
  if (amount.gt(remaining)) throw new GuardrailError("EXCEEDS_PAID"); // Rule: refund <= paid

  let refund;
  try {
    [refund] = await tx
      .insert(refunds)
      .values({
        orderId: cmd.orderId,
        paymentId: payment.id,
        amount: toDbAmount(amount),
        status: "pending",
        reason: cmd.reason,
        idempotencyKey: cmd.idempotencyKey,
        createdBy: cmd.actor,
        agentRunId: cmd.agentRunId ?? null,
        escalationId: cmd.escalationId ?? null,
      })
      .returning();
  } catch (e) {
    // uniq_active_refund_per_order OR refunds_idempotency_key_unique -> a refund
    // already exists for this order / request: fail safely, no duplicate.
    if (isUniqueViolation(e)) throw new ConflictError("refund_already_exists");
    throw e;
  }

  const fullyRefunded = refundedTotal.plus(amount).gte(capturedTotal);
  const updated = await tx
    .update(orders)
    .set({
      status: fullyRefunded ? "refunded" : "partially_refunded",
      version: sql`${orders.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(orders.id, cmd.orderId), eq(orders.version, order.version)))
    .returning({ id: orders.id });
  if (updated.length !== 1) throw new ConflictError("order_state_changed");

  return refund;
}

/** Mock payment provider settlement (idempotent, always succeeds here). */
export async function settleRefund(dbc: DB, refundId: string) {
  const [settled] = await dbc
    .update(refunds)
    .set({ status: "succeeded", externalRefundId: `mock_${refundId}` })
    .where(eq(refunds.id, refundId))
    .returning();
  return settled;
}

export async function executeRefund(cmd: RefundCommand, dbc: DB = appDb) {
  let refund;
  try {
    refund = await dbc.transaction((tx) => executeRefundWithinTx(tx, cmd));
  } catch (e) {
    const { outcome, violation } = classify(e);
    await logAttempt(dbc, "refund", cmd, cmd.orderId, outcome, violation);
    throw e;
  }
  const settled = await settleRefund(dbc, refund.id);
  await logAttempt(dbc, "refund", cmd, cmd.orderId, "executed", undefined, {
    refundId: settled.id,
    amount: settled.amount,
  });
  return settled;
}

// ---------------------------------------------------------------------------
// CANCELLATION
// ---------------------------------------------------------------------------
export async function executeCancellationWithinTx(tx: Txn, cmd: CancellationCommand) {
  const order = await lockOrder(tx, cmd.orderId);
  assertOwnership(order, cmd.requesterCustomerId);

  // Rule: no cancel once fulfilled. Delivery implies shipment, so guard on both.
  if (order.shippedAt !== null || order.deliveredAt !== null) {
    throw new GuardrailError("ALREADY_SHIPPED");
  }
  // A duplicate cancellation is caught by the partial unique index below
  // (uniq_active_cancellation_per_order) -> ConflictError, consistent with refund/replacement.

  let cancellation;
  try {
    [cancellation] = await tx
      .insert(cancellations)
      .values({
        orderId: cmd.orderId,
        status: "succeeded",
        reason: cmd.reason,
        idempotencyKey: cmd.idempotencyKey,
        createdBy: cmd.actor,
        agentRunId: cmd.agentRunId ?? null,
        escalationId: cmd.escalationId ?? null,
      })
      .returning();
  } catch (e) {
    if (isCheckViolation(e)) throw new GuardrailError("ALREADY_SHIPPED"); // trigger backstop
    if (isUniqueViolation(e)) throw new ConflictError("cancellation_already_exists");
    throw e;
  }

  const updated = await tx
    .update(orders)
    .set({
      status: "cancelled",
      cancelledAt: sql`now()`,
      version: sql`${orders.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(orders.id, cmd.orderId), eq(orders.version, order.version)))
    .returning({ id: orders.id });
  if (updated.length !== 1) throw new ConflictError("order_state_changed");

  return cancellation;
}

export async function executeCancellation(cmd: CancellationCommand, dbc: DB = appDb) {
  try {
    const cancellation = await dbc.transaction((tx) =>
      executeCancellationWithinTx(tx, cmd),
    );
    await logAttempt(dbc, "cancellation", cmd, cmd.orderId, "executed", undefined, {
      cancellationId: cancellation.id,
    });
    return cancellation;
  } catch (e) {
    const { outcome, violation } = classify(e);
    await logAttempt(dbc, "cancellation", cmd, cmd.orderId, outcome, violation);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// REPLACEMENT (human-approval only in practice; always safe to run here)
// ---------------------------------------------------------------------------
export async function executeReplacementWithinTx(tx: Txn, cmd: ReplacementCommand) {
  const order = await lockOrder(tx, cmd.orderId);
  assertOwnership(order, cmd.requesterCustomerId);

  if (order.deliveredAt === null) throw new GuardrailError("NOT_DELIVERED");
  const cutoffMs = Date.now() - config.REPLACEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (order.deliveredAt.getTime() < cutoffMs) {
    throw new GuardrailError("OUTSIDE_REPLACEMENT_WINDOW");
  }

  try {
    const [replacement] = await tx
      .insert(replacements)
      .values({
        orderId: cmd.orderId,
        itemSku: cmd.itemSku,
        status: "succeeded",
        reason: cmd.reason,
        idempotencyKey: cmd.idempotencyKey,
        createdBy: cmd.actor,
        agentRunId: cmd.agentRunId ?? null,
        escalationId: cmd.escalationId ?? null,
      })
      .returning();
    return replacement;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("replacement_already_exists");
    throw e;
  }
}

export async function executeReplacement(cmd: ReplacementCommand, dbc: DB = appDb) {
  try {
    const replacement = await dbc.transaction((tx) =>
      executeReplacementWithinTx(tx, cmd),
    );
    await logAttempt(dbc, "replacement", cmd, cmd.orderId, "executed", undefined, {
      replacementId: replacement.id,
    });
    return replacement;
  } catch (e) {
    const { outcome, violation } = classify(e);
    await logAttempt(dbc, "replacement", cmd, cmd.orderId, outcome, violation);
    throw e;
  }
}
