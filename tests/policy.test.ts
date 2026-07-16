import { describe, it, expect } from "vitest";
import { decidePolicy, type PolicyInput } from "../src/services/policy";

const REQUESTER = "cust-1";

function order(over: Partial<PolicyInput["order"] & object> = {}) {
  return {
    customerId: REQUESTER,
    shippedAt: null,
    createdAt: new Date(),
    capturedTotal: "100.00",
    refundedTotal: "0.00",
    ...over,
  };
}

describe("policy engine", () => {
  it("AUTO for a small refund within limits", () => {
    const d = decidePolicy({ actionType: "refund", amount: "40.00", requesterCustomerId: REQUESTER, order: order() });
    expect(d).toEqual({ mode: "AUTO", reasons: ["WITHIN_LIMITS"] });
  });

  it("ESCALATE for a refund above the auto limit", () => {
    const d = decidePolicy({ actionType: "refund", amount: "80.00", requesterCustomerId: REQUESTER, order: order() });
    expect(d.mode).toBe("ESCALATE");
    expect(d.reasons).toContain("ABOVE_AUTO_LIMIT");
  });

  it("ESCALATE for a refund exceeding amount paid", () => {
    const d = decidePolicy({ actionType: "refund", amount: "200.00", requesterCustomerId: REQUESTER, order: order() });
    expect(d.reasons).toContain("EXCEEDS_PAID");
  });

  it("REJECT for a refund when nothing is refundable", () => {
    const d = decidePolicy({
      actionType: "refund",
      amount: "10.00",
      requesterCustomerId: REQUESTER,
      order: order({ refundedTotal: "100.00" }),
    });
    expect(d).toEqual({ mode: "REJECT", reasons: ["NOTHING_REFUNDABLE"] });
  });

  it("AUTO for an unshipped, recent cancellation", () => {
    const d = decidePolicy({ actionType: "cancellation", requesterCustomerId: REQUESTER, order: order() });
    expect(d.mode).toBe("AUTO");
  });

  it("REJECT for cancelling a shipped order", () => {
    const d = decidePolicy({
      actionType: "cancellation",
      requesterCustomerId: REQUESTER,
      order: order({ shippedAt: new Date() }),
    });
    expect(d).toEqual({ mode: "REJECT", reasons: ["ALREADY_SHIPPED"] });
  });

  it("ESCALATE for a cancellation outside the window", () => {
    const d = decidePolicy({
      actionType: "cancellation",
      requesterCustomerId: REQUESTER,
      order: order({ createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) }),
    });
    expect(d.reasons).toContain("OUTSIDE_CANCEL_WINDOW");
  });

  it("ESCALATE for a replacement (always reviewed)", () => {
    const d = decidePolicy({ actionType: "replacement", requesterCustomerId: REQUESTER, order: order() });
    expect(d.reasons).toContain("REPLACEMENT_ALWAYS_REVIEWED");
  });

  it("ESCALATE when the requester does not own the order", () => {
    const d = decidePolicy({
      actionType: "refund",
      amount: "10.00",
      requesterCustomerId: REQUESTER,
      order: order({ customerId: "someone-else" }),
    });
    expect(d.reasons).toContain("NOT_AUTHORIZED");
  });

  it("ESCALATE when the order is missing (hallucinated id)", () => {
    const d = decidePolicy({ actionType: "refund", amount: "10.00", requesterCustomerId: REQUESTER, order: null });
    expect(d.reasons).toContain("ORDER_NOT_FOUND");
  });

  it("ESCALATE when the agent explicitly escalates or takes no action", () => {
    expect(decidePolicy({ actionType: "escalate", requesterCustomerId: REQUESTER, order: null }).mode).toBe("ESCALATE");
    expect(decidePolicy({ actionType: "no_action", requesterCustomerId: REQUESTER, order: null }).mode).toBe("ESCALATE");
  });
});
