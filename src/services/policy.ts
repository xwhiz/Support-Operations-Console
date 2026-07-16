/**
 * THE POLICY ENGINE — pure, deterministic. The agent decides *intent*; this
 * decides the *execution mode* (AUTO | ESCALATE | REJECT). It never trusts the
 * model's confidence or claims; it reads order facts and the configured limits.
 *
 *  AUTO     -> safe to execute automatically (within limits, requester owns it)
 *  REJECT   -> hard-invalid where declining is always safe (already shipped / nothing refundable)
 *  ESCALATE -> everything requiring human judgment (default toward the human)
 */
import { money } from "./money";
import { config } from "../config";

export type PolicyMode = "AUTO" | "ESCALATE" | "REJECT";

export type ReasonCode =
  | "WITHIN_LIMITS"
  | "ABOVE_AUTO_LIMIT"
  | "EXCEEDS_PAID"
  | "NOTHING_REFUNDABLE"
  | "ALREADY_SHIPPED"
  | "OUTSIDE_CANCEL_WINDOW"
  | "REPLACEMENT_ALWAYS_REVIEWED"
  | "NOT_AUTHORIZED"
  | "ORDER_NOT_FOUND"
  | "AMBIGUOUS"
  | "AGENT_REQUESTED"
  | "NO_ACTION";

export type PolicyDecision = { mode: PolicyMode; reasons: ReasonCode[] };

export type PolicyOrderFacts = {
  customerId: string;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  capturedTotal: string;
  refundedTotal: string;
};

export type PolicyInput = {
  actionType: "refund" | "cancellation" | "replacement" | "escalate" | "no_action";
  amount?: string | null;
  requesterCustomerId: string;
  order: PolicyOrderFacts | null;
};

export function decidePolicy(input: PolicyInput): PolicyDecision {
  if (input.actionType === "escalate") return { mode: "ESCALATE", reasons: ["AGENT_REQUESTED"] };
  if (input.actionType === "no_action") return { mode: "ESCALATE", reasons: ["NO_ACTION"] };

  // Hard-invalid targets are auto-declined (REJECT), NOT escalated — escalating a
  // cross-tenant/nonexistent order would create a human-approvable action on an
  // order the requester doesn't own.
  if (!input.order) return { mode: "REJECT", reasons: ["ORDER_NOT_FOUND"] };
  if (input.order.customerId !== input.requesterCustomerId) {
    return { mode: "REJECT", reasons: ["NOT_AUTHORIZED"] };
  }

  if (input.actionType === "replacement") {
    return { mode: "ESCALATE", reasons: ["REPLACEMENT_ALWAYS_REVIEWED"] };
  }

  if (input.actionType === "refund") {
    const remaining = money(input.order.capturedTotal).minus(input.order.refundedTotal);
    const amount = money(input.amount ?? "0");
    if (remaining.lte(0)) return { mode: "REJECT", reasons: ["NOTHING_REFUNDABLE"] };
    if (amount.gt(remaining)) return { mode: "ESCALATE", reasons: ["EXCEEDS_PAID"] };
    if (amount.gt(money(config.AUTO_REFUND_MAX))) {
      return { mode: "ESCALATE", reasons: ["ABOVE_AUTO_LIMIT"] };
    }
    return { mode: "AUTO", reasons: ["WITHIN_LIMITS"] };
  }

  if (input.actionType === "cancellation") {
    // Delivery implies shipment: an order that has shipped OR been delivered is
    // past the point of cancellation.
    if (input.order.shippedAt !== null || input.order.deliveredAt !== null) {
      return { mode: "REJECT", reasons: ["ALREADY_SHIPPED"] };
    }
    const hours = (Date.now() - input.order.createdAt.getTime()) / 3_600_000;
    if (hours > config.CANCEL_AUTO_WINDOW_HOURS) {
      return { mode: "ESCALATE", reasons: ["OUTSIDE_CANCEL_WINDOW"] };
    }
    return { mode: "AUTO", reasons: ["WITHIN_LIMITS"] };
  }

  return { mode: "ESCALATE", reasons: ["AMBIGUOUS"] };
}
