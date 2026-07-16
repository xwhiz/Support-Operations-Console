/**
 * Support-request orchestration (testable; the route handler is a thin wrapper).
 *   agent loop -> terminal proposal  ->  Policy Engine  ->  act:
 *     AUTO     -> Guarded Executor (refund/cancellation); if the executor
 *                 refuses (source of truth), fall back to escalation.
 *     ESCALATE -> create a pending escalation for a human reviewer.
 *     REJECT   -> decline; no execution.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db as appDb, type DB } from "../db/client";
import {
  orders,
  payments,
  refunds,
  proposedActions,
  escalations,
  supportRequests,
  agentRuns,
} from "../db/schema";
import { runAgent } from "../agent/loop";
import type { LlmClient } from "../agent/llm";
import { decidePolicy, type PolicyMode, type ReasonCode } from "./policy";
import { executeRefund, executeCancellation } from "./guarded-executor";
import { sumMoney, toDbAmount } from "./money";
import { describeAction } from "../lib/describe";
import { GuardrailError, ConflictError } from "./errors";

export type IntakeDecision = "auto_resolved" | "escalated" | "rejected";

export type IntakeResult = {
  supportRequestId: string;
  agentRunId: string;
  decision: IntakeDecision;
  mode: PolicyMode;
  reasons: ReasonCode[];
  finalMessage: string;
  decisionSummary: string;
  escalationId?: string;
  action: { type: string; description: string };
};

function buildSummary(
  description: string,
  mode: PolicyMode,
  reasons: ReasonCode[],
  rationale?: string,
): string {
  const base = `${description}. Policy: ${mode} (${reasons.join(", ")}).`;
  return rationale ? `${base} Agent rationale: ${rationale}` : base;
}

/** Deterministic customer-facing message (avoids an extra LLM round-trip). */
function customerMessage(
  status: IntakeDecision,
  reasons: ReasonCode[],
  description: string,
): string {
  if (status === "auto_resolved") {
    return `All set — your request has been processed: ${description}. You'll see it reflected on your order shortly.`;
  }
  if (status === "rejected") {
    if (reasons.includes("NOTHING_REFUNDABLE")) {
      return "This order has already been fully refunded, so there's nothing further to refund. If you believe this is an error, reply and a specialist will review it.";
    }
    if (reasons.includes("ALREADY_SHIPPED")) {
      return "This order has already shipped, so it can no longer be cancelled. Once it arrives, we can help with a return or replacement if there's an issue.";
    }
    return "We couldn't complete this request automatically.";
  }
  return "Thanks — I've passed this to our support team for review. A specialist will follow up with you shortly.";
}

export async function handleSupportRequest(params: {
  requesterCustomerId: string;
  rawText: string;
  channel?: string;
  llm?: LlmClient;
  dbc?: DB;
}): Promise<IntakeResult> {
  const dbc = params.dbc ?? appDb;

  const run = await runAgent({
    requesterCustomerId: params.requesterCustomerId,
    rawText: params.rawText,
    channel: params.channel,
    llm: params.llm,
    dbc,
  });
  const proposal = run.proposal;
  const payload = proposal.payload;

  // Resolve order facts for the policy (global lookup by number; policy checks ownership).
  let orderRow: typeof orders.$inferSelect | null = null;
  let orderFacts = null as null | {
    customerId: string;
    shippedAt: Date | null;
    createdAt: Date;
    capturedTotal: string;
    refundedTotal: string;
  };
  if (payload.orderNumber) {
    const [row] = await dbc
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, payload.orderNumber))
      .limit(1);
    orderRow = row ?? null;
    if (orderRow) {
      const [caps, refs] = await Promise.all([
        dbc
          .select()
          .from(payments)
          .where(and(eq(payments.orderId, orderRow.id), eq(payments.status, "captured"))),
        dbc
          .select()
          .from(refunds)
          .where(
            and(eq(refunds.orderId, orderRow.id), inArray(refunds.status, ["pending", "succeeded"])),
          ),
      ]);
      orderFacts = {
        customerId: orderRow.customerId,
        shippedAt: orderRow.shippedAt,
        createdAt: orderRow.createdAt,
        capturedTotal: toDbAmount(sumMoney(caps.map((p) => p.amount))),
        refundedTotal: toDbAmount(sumMoney(refs.map((r) => r.amount))),
      };
    }
  }

  const decision = decidePolicy({
    actionType: proposal.actionType,
    amount: proposal.amount,
    requesterCustomerId: params.requesterCustomerId,
    order: orderFacts,
  });

  const description = describeAction(payload);
  let decisionSummary = buildSummary(description, decision.mode, decision.reasons, payload.rationale);

  await dbc
    .update(proposedActions)
    .set({
      policyMode: decision.mode,
      policyReasons: decision.reasons,
      requiresHumanApproval: decision.mode !== "AUTO",
    })
    .where(eq(proposedActions.id, proposal.id));

  const finish = async (
    status: "auto_resolved" | "escalated" | "rejected",
    finalDecision: string,
    escalationId?: string,
  ): Promise<IntakeResult> => {
    const finalMessage = run.finalMessage?.trim()
      ? run.finalMessage
      : customerMessage(status, decision.reasons, description);
    await dbc
      .update(agentRuns)
      .set({ finalDecision, decisionSummary, finalMessage })
      .where(eq(agentRuns.id, run.agentRunId));
    await dbc
      .update(supportRequests)
      .set({ status, updatedAt: new Date() })
      .where(eq(supportRequests.id, run.supportRequestId));
    return {
      supportRequestId: run.supportRequestId,
      agentRunId: run.agentRunId,
      decision: status,
      mode: decision.mode,
      reasons: decision.reasons,
      finalMessage,
      decisionSummary,
      escalationId,
      action: { type: proposal.actionType, description },
    };
  };

  const createEscalation = async () => {
    const [esc] = await dbc
      .insert(escalations)
      .values({
        supportRequestId: run.supportRequestId,
        proposedActionId: proposal.id,
        orderId: orderRow?.id ?? null,
        status: "pending",
      })
      .returning();
    return esc;
  };

  // ---- AUTO: execute immediately through the Guarded Executor ----
  if (decision.mode === "AUTO" && orderRow) {
    const ctx = {
      actor: "agent",
      initiatedVia: "auto" as const,
      requesterCustomerId: params.requesterCustomerId,
      agentRunId: run.agentRunId,
    };
    const idempotencyKey = `auto:${proposal.actionType}:${run.supportRequestId}`;
    try {
      if (proposal.actionType === "refund") {
        await executeRefund({ ...ctx, orderId: orderRow.id, amount: proposal.amount ?? "0", idempotencyKey }, dbc);
      } else if (proposal.actionType === "cancellation") {
        await executeCancellation({ ...ctx, orderId: orderRow.id, idempotencyKey }, dbc);
      }
      return finish("auto_resolved", "AUTO");
    } catch (e) {
      // Executor is the source of truth. If it refuses what policy allowed,
      // escalate instead of failing the customer.
      if (e instanceof GuardrailError || e instanceof ConflictError) {
        decisionSummary = `${decisionSummary} Auto-execution refused by executor (${
          e instanceof GuardrailError ? e.code : (e as ConflictError).code
        }); escalated.`;
        await dbc
          .update(proposedActions)
          .set({ requiresHumanApproval: true })
          .where(eq(proposedActions.id, proposal.id));
        const esc = await createEscalation();
        return finish("escalated", "AUTO_FALLBACK_ESCALATE", esc.id);
      }
      throw e;
    }
  }

  // ---- REJECT: auto-decline, no execution ----
  if (decision.mode === "REJECT") {
    return finish("rejected", "REJECT");
  }

  // ---- ESCALATE (default) ----
  const esc = await createEscalation();
  return finish("escalated", "ESCALATE", esc.id);
}
