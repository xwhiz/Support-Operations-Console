import type { Tone } from "./Badge";

export type StatusView = { label: string; tone: Tone };

/**
 * Single source of truth for turning domain statuses into a label + color tone.
 * Replaces the badge logic that used to be duplicated across the portal and
 * console clients.
 */

/** Order lifecycle status (orders.status). */
export function orderStatusView(status: string): StatusView {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "gray" };
    case "paid":
      return { label: "Paid", tone: "info" };
    case "processing":
      return { label: "Processing", tone: "info" };
    case "shipped":
      return { label: "Shipped", tone: "info" };
    case "delivered":
      return { label: "Delivered", tone: "success" };
    case "cancelled":
      return { label: "Cancelled", tone: "error" };
    case "refunded":
      return { label: "Refunded", tone: "warning" };
    case "partially_refunded":
      return { label: "Partially refunded", tone: "warning" };
    default:
      return { label: status, tone: "gray" };
  }
}

type RequestLike = {
  requestStatus?: string | null;
  status?: string | null;
  escalationStatus?: string | null;
};

/**
 * Support-request outcome, from the reviewer's vantage point (queue / detail).
 * Escalation state wins over the raw request status when present.
 */
export function requestStatusView(r: RequestLike): StatusView {
  const requestStatus = r.requestStatus ?? r.status ?? "";
  const esc = r.escalationStatus;
  if (esc === "pending") return { label: "Needs review", tone: "warning" };
  if (esc === "approved" || esc === "executed")
    return { label: "Approved", tone: "success" };
  if (esc === "rejected") return { label: "Rejected", tone: "error" };
  if (esc === "execution_failed")
    return { label: "Execution failed", tone: "error" };
  if (requestStatus === "auto_resolved")
    return { label: "Auto-resolved", tone: "success" };
  if (requestStatus === "rejected")
    return { label: "Auto-declined", tone: "gray" };
  if (requestStatus === "failed") return { label: "Failed", tone: "error" };
  if (requestStatus === "escalated")
    return { label: "Escalated", tone: "warning" };
  if (requestStatus === "processing")
    return { label: "Processing", tone: "info" };
  if (requestStatus === "received") return { label: "Received", tone: "info" };
  return { label: requestStatus || "—", tone: "gray" };
}

/** Same outcome, worded for the customer's own view of their request. */
export function customerRequestStatusView(r: RequestLike): StatusView {
  const requestStatus = r.requestStatus ?? r.status ?? "";
  const esc = r.escalationStatus;
  if (esc === "pending") return { label: "Under review", tone: "warning" };
  if (esc === "approved" || esc === "executed")
    return { label: "Approved", tone: "success" };
  if (esc === "rejected")
    return { label: "Declined after review", tone: "error" };
  if (requestStatus === "auto_resolved")
    return { label: "Resolved", tone: "success" };
  if (requestStatus === "rejected") return { label: "Declined", tone: "gray" };
  if (requestStatus === "failed")
    return { label: "Needs attention", tone: "error" };
  if (requestStatus === "escalated" || requestStatus === "processing")
    return { label: "In progress", tone: "info" };
  return { label: "Received", tone: "info" };
}
