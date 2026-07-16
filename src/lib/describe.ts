/**
 * Renders a proposed action as a single plain-language sentence. Used by BOTH
 * the reviewer UI and the API so the description a human sees can never diverge
 * from the structured payload the executor consumes.
 */
import type { ProposedActionPayload } from "../db/schema";
import { formatMoney } from "./format";

export function formatAmount(amount?: string | null, currency = "USD"): string {
  if (!amount) return "";
  return formatMoney(amount, currency);
}

export function describeAction(p: ProposedActionPayload): string {
  const order = p.orderNumber ? `order #${p.orderNumber}` : "the order";
  switch (p.type) {
    case "refund":
      return `Refund ${formatAmount(p.amount, p.currency)} for ${order}`;
    case "cancellation":
      return `Cancel ${order}`;
    case "replacement":
      return `Ship a replacement${p.itemSku ? ` (${p.itemSku})` : ""} for ${order}`;
    case "escalate":
      return `Escalate ${order} to a human reviewer`;
    default:
      return `No automated action for ${order}`;
  }
}
