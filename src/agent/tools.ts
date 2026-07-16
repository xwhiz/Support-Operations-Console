/**
 * Agent tools: 2 READ tools (scoped to the authenticated requester) and 4
 * PROPOSE tools that only record a proposed_actions row and return an ack.
 * NO tool mutates money/order state — that is the executor's job alone.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import {
  orders,
  orderItems,
  payments,
  refunds,
  proposedActions,
  type ProposedActionPayload,
} from "../db/schema";
import { money, sumMoney, toDbAmount } from "../services/money";
import type { ToolDef } from "./llm";

export type ToolContext = {
  requesterCustomerId: string;
  agentRunId: string;
  supportRequestId: string;
  dbc: DB;
};

export type ToolResult = {
  response: Record<string, unknown>;
  isError: boolean;
  proposal?: typeof proposedActions.$inferSelect;
};

export const PROPOSAL_TOOLS = new Set([
  "proposeRefund",
  "proposeCancellation",
  "proposeReplacement",
  "escalate",
]);

// ---------------------------------------------------------------------------
// Tool declarations sent to the model (plain JSON Schema)
// ---------------------------------------------------------------------------
export const TOOL_DEFS: ToolDef[] = [
  {
    name: "getOrder",
    description:
      "Look up one of the customer's orders by its number. Returns status, amounts paid/refunded, the refundable amount, and line items. Only the authenticated customer's own orders are visible.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        orderNumber: { type: "integer", description: "Customer-facing order number, e.g. 1043" },
      },
      required: ["orderNumber"],
    },
  },
  {
    name: "getCustomerOrders",
    description: "List the authenticated customer's orders (number, status, total).",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "proposeRefund",
    description:
      "Propose refunding an order. Does NOT issue the refund — the system validates it and either auto-executes or routes it to a human reviewer. Call getOrder first.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        orderNumber: { type: "integer" },
        amount: { type: "number", description: "Refund amount; must not exceed the amount paid." },
        reason: { type: "string", description: "Why a refund is appropriate." },
        confidence: { type: "number", description: "0..1 self-assessed confidence (advisory only)." },
      },
      required: ["orderNumber", "amount", "reason"],
    },
  },
  {
    name: "proposeCancellation",
    description:
      "Propose cancelling an order. Does NOT cancel it — the system validates and auto-executes or escalates. Call getOrder first.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        orderNumber: { type: "integer" },
        reason: { type: "string" },
        confidence: { type: "number", description: "0..1 (advisory only)." },
      },
      required: ["orderNumber", "reason"],
    },
  },
  {
    name: "proposeReplacement",
    description:
      "Propose shipping a replacement (e.g. for a damaged item). Always routed to a human reviewer.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        orderNumber: { type: "integer" },
        itemSku: { type: "string" },
        reason: { type: "string" },
        confidence: { type: "number", description: "0..1 (advisory only)." },
      },
      required: ["orderNumber", "reason"],
    },
  },
  {
    name: "escalate",
    description:
      "Hand the request to a human reviewer when it is ambiguous, out of scope, or you are unsure. Prefer this over guessing.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        orderNumber: { type: "integer" },
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
];

// ---------------------------------------------------------------------------
// Arg schemas
// ---------------------------------------------------------------------------
const getOrderArgs = z.object({ orderNumber: z.number().int() });
const refundArgs = z.object({
  orderNumber: z.number().int(),
  amount: z.number().positive(),
  reason: z.string(),
  confidence: z.number().optional(),
});
const cancelArgs = z.object({
  orderNumber: z.number().int(),
  reason: z.string(),
  confidence: z.number().optional(),
});
const replacementArgs = z.object({
  orderNumber: z.number().int(),
  itemSku: z.string().optional(),
  reason: z.string(),
  confidence: z.number().optional(),
});
const escalateArgs = z.object({
  orderNumber: z.number().int().optional(),
  reason: z.string(),
});

// ---------------------------------------------------------------------------
// Read implementations (scoped to the requester)
// ---------------------------------------------------------------------------
async function getOrderTool(ctx: ToolContext, orderNumber: number): Promise<ToolResult> {
  const [order] = await ctx.dbc
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, ctx.requesterCustomerId)))
    .limit(1);
  if (!order) {
    return {
      response: { found: false, message: `Order ${orderNumber} was not found on your account.` },
      isError: false,
    };
  }
  const [items, capturedPays, activeRefunds] = await Promise.all([
    ctx.dbc.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    ctx.dbc
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, "captured"))),
    ctx.dbc
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ["pending", "succeeded"]))),
  ]);
  const paid = sumMoney(capturedPays.map((p) => p.amount));
  const refunded = sumMoney(activeRefunds.map((r) => r.amount));
  return {
    isError: false,
    response: {
      found: true,
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        currency: order.currency,
        total: order.totalAmount,
        shipped: order.shippedAt !== null,
        delivered: order.deliveredAt !== null,
        items: items.map((i) => ({ sku: i.sku, description: i.description, quantity: i.quantity })),
      },
      amountPaid: toDbAmount(paid),
      amountRefunded: toDbAmount(refunded),
      refundableAmount: toDbAmount(paid.minus(refunded)),
    },
  };
}

async function getCustomerOrdersTool(ctx: ToolContext): Promise<ToolResult> {
  const list = await ctx.dbc
    .select()
    .from(orders)
    .where(eq(orders.customerId, ctx.requesterCustomerId));
  return {
    isError: false,
    response: {
      orders: list.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.totalAmount,
        currency: o.currency,
        shipped: o.shippedAt !== null,
        delivered: o.deliveredAt !== null,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Proposal implementation (records intent only)
// ---------------------------------------------------------------------------
async function resolveOrderId(ctx: ToolContext, orderNumber?: number): Promise<string | null> {
  if (!orderNumber) return null;
  const [o] = await ctx.dbc
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  return o?.id ?? null;
}

async function recordProposal(
  ctx: ToolContext,
  actionType: ProposedActionPayload["type"],
  payload: ProposedActionPayload,
  amount?: string,
): Promise<ToolResult> {
  const targetOrderId = await resolveOrderId(ctx, payload.orderNumber);
  const [row] = await ctx.dbc
    .insert(proposedActions)
    .values({
      agentRunId: ctx.agentRunId,
      supportRequestId: ctx.supportRequestId,
      actionType,
      targetOrderId,
      amount: amount ?? null,
      payload,
    })
    .returning();
  return {
    isError: false,
    proposal: row,
    response: {
      status: "proposal_recorded",
      note: "Recorded for system review. No action has been taken yet; the system will validate it and either execute automatically or route it to a human reviewer.",
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "getOrder": {
        const { orderNumber } = getOrderArgs.parse(rawArgs);
        return await getOrderTool(ctx, orderNumber);
      }
      case "getCustomerOrders":
        return await getCustomerOrdersTool(ctx);
      case "proposeRefund": {
        const a = refundArgs.parse(rawArgs);
        const amount = toDbAmount(money(a.amount));
        return await recordProposal(
          ctx,
          "refund",
          { type: "refund", orderNumber: a.orderNumber, amount, currency: "USD", rationale: a.reason, confidence: a.confidence },
          amount,
        );
      }
      case "proposeCancellation": {
        const a = cancelArgs.parse(rawArgs);
        return await recordProposal(ctx, "cancellation", {
          type: "cancellation",
          orderNumber: a.orderNumber,
          rationale: a.reason,
          confidence: a.confidence,
        });
      }
      case "proposeReplacement": {
        const a = replacementArgs.parse(rawArgs);
        return await recordProposal(ctx, "replacement", {
          type: "replacement",
          orderNumber: a.orderNumber,
          itemSku: a.itemSku,
          rationale: a.reason,
          confidence: a.confidence,
        });
      }
      case "escalate": {
        const a = escalateArgs.parse(rawArgs);
        return await recordProposal(ctx, "escalate", {
          type: "escalate",
          orderNumber: a.orderNumber,
          rationale: a.reason,
        });
      }
      default:
        return { isError: true, response: { error: `unknown_tool:${name}` } };
    }
  } catch (e) {
    return {
      isError: true,
      response: { error: "invalid_tool_input", detail: e instanceof Error ? e.message : String(e) },
    };
  }
}
