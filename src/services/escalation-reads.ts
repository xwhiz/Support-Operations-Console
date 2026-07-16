/**
 * Read models for the reviewer console: the queue list and a single escalation's
 * full detail (request + proposal + order facts + agent trace).
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb, type DB } from "../db/client";
import {
  supportRequests,
  agentRuns,
  agentMessages,
  toolCalls,
  proposedActions,
  escalations,
  orders,
  orderItems,
  payments,
  refunds,
  users,
  type ProposedActionPayload,
} from "../db/schema";
import { describeAction } from "../lib/describe";
import { money, sumMoney, toDbAmount } from "./money";

const reviewers = alias(users, "reviewers");

export type QueueFilter = "needs_review" | "all";

export async function listQueue(filter: QueueFilter, dbc: DB = appDb) {
  const base = await dbc
    .select({
      supportRequestId: supportRequests.id,
      createdAt: supportRequests.createdAt,
      requestStatus: supportRequests.status,
      message: supportRequests.rawText,
      customerName: users.name,
      customerEmail: users.email,
      agentRunId: agentRuns.id,
      finalDecision: agentRuns.finalDecision,
      escalationId: escalations.id,
      escalationStatus: escalations.status,
      escalationVersion: escalations.version,
      decidedByName: reviewers.name,
      decidedAt: escalations.decidedAt,
    })
    .from(supportRequests)
    .leftJoin(agentRuns, eq(agentRuns.supportRequestId, supportRequests.id))
    .leftJoin(users, eq(users.id, supportRequests.requesterCustomerId))
    .leftJoin(escalations, eq(escalations.supportRequestId, supportRequests.id))
    .leftJoin(reviewers, eq(reviewers.id, escalations.decidedByReviewerId))
    .orderBy(filter === "needs_review" ? asc(supportRequests.createdAt) : desc(supportRequests.createdAt));

  // Fetch the proposal per run in one query, then merge (avoids N+1).
  const runIds = base.map((b) => b.agentRunId).filter((x): x is string => Boolean(x));
  const props = runIds.length
    ? await dbc.select().from(proposedActions).where(inArray(proposedActions.agentRunId, runIds))
    : [];
  const propByRun = new Map<string, (typeof props)[number]>();
  for (const p of props) if (p.agentRunId) propByRun.set(p.agentRunId, p);

  const items = base.map((b) => {
    const p = b.agentRunId ? propByRun.get(b.agentRunId) : undefined;
    const payload = (p?.payload ?? { type: "no_action" }) as ProposedActionPayload;
    return {
      supportRequestId: b.supportRequestId,
      createdAt: b.createdAt,
      requestStatus: b.requestStatus,
      message: b.message,
      customerName: b.customerName ?? b.customerEmail,
      decision: b.finalDecision ?? b.requestStatus,
      actionType: payload.type,
      actionDescription: describeAction(payload),
      amount: p?.amount ?? null,
      policyReasons: (p?.policyReasons ?? []) as string[],
      escalationId: b.escalationId,
      escalationStatus: b.escalationStatus,
      escalationVersion: b.escalationVersion,
      decidedByName: b.decidedByName,
      decidedAt: b.decidedAt,
    };
  });

  return filter === "needs_review"
    ? items.filter((i) => i.escalationStatus === "pending")
    : items;
}

export async function getEscalationDetail(escalationId: string, dbc: DB = appDb) {
  const [row] = await dbc
    .select({
      escalation: escalations,
      request: supportRequests,
      proposal: proposedActions,
      run: agentRuns,
      customerName: users.name,
      customerEmail: users.email,
      decidedByName: reviewers.name,
    })
    .from(escalations)
    .innerJoin(supportRequests, eq(supportRequests.id, escalations.supportRequestId))
    .innerJoin(proposedActions, eq(proposedActions.id, escalations.proposedActionId))
    .leftJoin(agentRuns, eq(agentRuns.id, proposedActions.agentRunId))
    .leftJoin(users, eq(users.id, supportRequests.requesterCustomerId))
    .leftJoin(reviewers, eq(reviewers.id, escalations.decidedByReviewerId))
    .where(eq(escalations.id, escalationId))
    .limit(1);

  if (!row) return null;

  // Order facts (only if an order is attached).
  let orderFacts: {
    orderNumber: number;
    status: string;
    currency: string;
    total: string;
    shipped: boolean;
    delivered: boolean;
    amountPaid: string;
    amountRefunded: string;
    refundableAmount: string;
    items: { sku: string; description: string | null; quantity: number }[];
  } | null = null;
  if (row.escalation.orderId) {
    const [order] = await dbc.select().from(orders).where(eq(orders.id, row.escalation.orderId)).limit(1);
    if (order) {
      const [items, caps, refs] = await Promise.all([
        dbc.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
        dbc.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.status, "captured"))),
        dbc.select().from(refunds).where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ["pending", "succeeded"]))),
      ]);
      const paid = sumMoney(caps.map((p) => p.amount));
      const refunded = sumMoney(refs.map((r) => r.amount));
      orderFacts = {
        orderNumber: order.orderNumber,
        status: order.status,
        currency: order.currency,
        total: order.totalAmount,
        shipped: order.shippedAt !== null,
        delivered: order.deliveredAt !== null,
        amountPaid: toDbAmount(paid),
        amountRefunded: toDbAmount(refunded),
        refundableAmount: toDbAmount(money(paid).minus(refunded)),
        items: items.map((i) => ({ sku: i.sku, description: i.description, quantity: i.quantity })),
      };
    }
  }

  const trace = row.run
    ? await dbc.select().from(toolCalls).where(eq(toolCalls.agentRunId, row.run.id)).orderBy(asc(toolCalls.seq))
    : [];
  const messages = row.run
    ? await dbc
        .select({ seq: agentMessages.seq, role: agentMessages.role, content: agentMessages.content })
        .from(agentMessages)
        .where(eq(agentMessages.agentRunId, row.run.id))
        .orderBy(asc(agentMessages.seq))
    : [];

  const payload = row.proposal.payload as ProposedActionPayload;

  return {
    escalation: {
      id: row.escalation.id,
      status: row.escalation.status,
      version: row.escalation.version,
      decision: row.escalation.decision,
      decisionNote: row.escalation.decisionNote,
      decidedByReviewerId: row.escalation.decidedByReviewerId,
      decidedByName: row.decidedByName,
      decidedAt: row.escalation.decidedAt,
      createdAt: row.escalation.createdAt,
    },
    request: {
      id: row.request.id,
      message: row.request.rawText,
      customerName: row.customerName ?? row.customerEmail,
      createdAt: row.request.createdAt,
      status: row.request.status,
    },
    proposal: {
      actionType: row.proposal.actionType,
      description: describeAction(payload),
      payload,
      amount: row.proposal.amount,
      policyMode: row.proposal.policyMode,
      policyReasons: (row.proposal.policyReasons ?? []) as string[],
      requiresHumanApproval: row.proposal.requiresHumanApproval,
    },
    order: orderFacts,
    trace: {
      model: row.run?.model ?? null,
      decisionSummary: row.run?.decisionSummary ?? null,
      finalMessage: row.run?.finalMessage ?? null,
      stopReason: row.run?.stopReason ?? null,
      toolCalls: trace.map((t) => ({
        toolName: t.toolName,
        input: t.input,
        output: t.output,
        isError: t.isError,
      })),
      messageCount: messages.length,
    },
  };
}

export type EscalationDetail = NonNullable<Awaited<ReturnType<typeof getEscalationDetail>>>;

/** A customer's own support requests + outcomes (own-data scoped by caller). */
export async function listCustomerRequests(customerId: string, dbc: DB = appDb) {
  const rows = await dbc
    .select({
      id: supportRequests.id,
      message: supportRequests.rawText,
      createdAt: supportRequests.createdAt,
      status: supportRequests.status,
      agentRunId: agentRuns.id,
      finalDecision: agentRuns.finalDecision,
      finalMessage: agentRuns.finalMessage,
      escalationStatus: escalations.status,
    })
    .from(supportRequests)
    .leftJoin(agentRuns, eq(agentRuns.supportRequestId, supportRequests.id))
    .leftJoin(escalations, eq(escalations.supportRequestId, supportRequests.id))
    .where(eq(supportRequests.requesterCustomerId, customerId))
    .orderBy(desc(supportRequests.createdAt));

  const runIds = rows.map((r) => r.agentRunId).filter((x): x is string => Boolean(x));
  const props = runIds.length
    ? await dbc.select().from(proposedActions).where(inArray(proposedActions.agentRunId, runIds))
    : [];
  const propByRun = new Map<string, (typeof props)[number]>();
  for (const p of props) if (p.agentRunId) propByRun.set(p.agentRunId, p);

  return rows.map((r) => {
    const p = r.agentRunId ? propByRun.get(r.agentRunId) : undefined;
    const payload = (p?.payload ?? { type: "no_action" }) as ProposedActionPayload;
    return {
      id: r.id,
      message: r.message,
      createdAt: r.createdAt,
      status: r.status,
      escalationStatus: r.escalationStatus,
      actionDescription: describeAction(payload),
      finalMessage: r.finalMessage,
    };
  });
}
