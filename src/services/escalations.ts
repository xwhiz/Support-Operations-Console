/**
 * Reviewer decisions on escalations. The double-approval exactly-once guarantee:
 *   1. SELECT ... FOR UPDATE on the escalation      -> second reviewer blocks
 *   2. status must be 'pending' AND version == expected (optimistic CAS)
 *   3. approval runs the guarded execution WITHIN the same transaction
 *   4. conditional UPDATE ... WHERE status='pending' AND version=? (RETURNING)
 * Three independent guards; the loser gets a ConflictError carrying current state.
 */
import { and, eq, sql } from "drizzle-orm";
import { db as appDb, type DB } from "../db/client";
import { escalations, proposedActions } from "../db/schema";
import {
  executeRefundWithinTx,
  executeCancellationWithinTx,
  executeReplacementWithinTx,
  settleRefund,
} from "./guarded-executor";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export type DecisionCommand = {
  escalationId: string;
  expectedVersion: number;
  reviewerId: string;
  note?: string;
};

const EXECUTABLE = new Set(["refund", "cancellation", "replacement"]);

export async function approveEscalation(cmd: DecisionCommand, dbc: DB = appDb) {
  const result = await dbc.transaction(async (tx) => {
    const [esc] = await tx
      .select()
      .from(escalations)
      .where(eq(escalations.id, cmd.escalationId))
      .for("update");
    if (!esc) throw new NotFoundError("escalation_not_found");
    if (esc.status !== "pending") throw new ConflictError("already_decided", esc);
    if (esc.version !== cmd.expectedVersion) throw new ConflictError("stale_version", esc);

    const [pa] = await tx
      .select()
      .from(proposedActions)
      .where(eq(proposedActions.id, esc.proposedActionId))
      .limit(1);
    if (!pa) throw new NotFoundError("proposed_action_not_found");
    if (!esc.orderId || !EXECUTABLE.has(pa.actionType)) {
      throw new ValidationError("no_executable_action");
    }

    const execCtx = {
      actor: `reviewer:${cmd.reviewerId}`,
      initiatedVia: "human_approval" as const,
      agentRunId: pa.agentRunId,
      escalationId: esc.id,
      reviewerId: cmd.reviewerId,
    };
    const idempotencyKey = `approve:${esc.id}`;

    let refundId: string | null = null;
    let cancellationId: string | null = null;
    let replacementId: string | null = null;
    if (pa.actionType === "refund") {
      const r = await executeRefundWithinTx(tx, {
        ...execCtx,
        orderId: esc.orderId,
        amount: pa.amount ?? "0",
        idempotencyKey,
      });
      refundId = r.id;
    } else if (pa.actionType === "cancellation") {
      const c = await executeCancellationWithinTx(tx, { ...execCtx, orderId: esc.orderId, idempotencyKey });
      cancellationId = c.id;
    } else {
      const rp = await executeReplacementWithinTx(tx, { ...execCtx, orderId: esc.orderId, idempotencyKey });
      replacementId = rp.id;
    }

    const updated = await tx
      .update(escalations)
      .set({
        status: "executed",
        decision: "approve",
        decidedByReviewerId: cmd.reviewerId,
        decisionNote: cmd.note ?? null,
        decidedAt: sql`now()`,
        executedAt: sql`now()`,
        resultingRefundId: refundId,
        resultingCancellationId: cancellationId,
        resultingReplacementId: replacementId,
        version: sql`${escalations.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(escalations.id, esc.id),
          eq(escalations.status, "pending"),
          eq(escalations.version, cmd.expectedVersion),
        ),
      )
      .returning();
    if (updated.length !== 1) throw new ConflictError("already_decided", esc);

    return { escalation: updated[0], refundId };
  });

  // Settle the mock payment provider outside the transaction (idempotency-keyed).
  if (result.refundId) await settleRefund(dbc, result.refundId);
  return result.escalation;
}

export async function rejectEscalation(cmd: DecisionCommand, dbc: DB = appDb) {
  return dbc.transaction(async (tx) => {
    const [esc] = await tx
      .select()
      .from(escalations)
      .where(eq(escalations.id, cmd.escalationId))
      .for("update");
    if (!esc) throw new NotFoundError("escalation_not_found");
    if (esc.status !== "pending") throw new ConflictError("already_decided", esc);
    if (esc.version !== cmd.expectedVersion) throw new ConflictError("stale_version", esc);

    const updated = await tx
      .update(escalations)
      .set({
        status: "rejected",
        decision: "reject",
        decidedByReviewerId: cmd.reviewerId,
        decisionNote: cmd.note ?? null,
        decidedAt: sql`now()`,
        version: sql`${escalations.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(escalations.id, esc.id),
          eq(escalations.status, "pending"),
          eq(escalations.version, cmd.expectedVersion),
        ),
      )
      .returning();
    if (updated.length !== 1) throw new ConflictError("already_decided", esc);
    return updated[0];
  });
}
