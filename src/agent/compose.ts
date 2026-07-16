/**
 * Composes the customer-facing reply with the LLM, AFTER the deterministic policy
 * decision is known — so the wording reflects what actually happened (auto-resolved,
 * escalated, or declined) without the model ever deciding the outcome itself.
 * Returns null on any failure so the caller can fall back to a static template.
 */
import { createGeminiClient, type LlmClient } from "./llm";
import type { ReasonCode } from "../services/policy";

export type ComposeInput = {
  request: string;
  decision: "auto_resolved" | "escalated" | "rejected";
  actionDescription: string;
  reasons: ReasonCode[];
  llm?: LlmClient;
};

const SYSTEM = `You write the short reply a customer sees from an e-commerce support team. 1–3 sentences, warm and clear. Base the reply ONLY on the outcome line provided. Rules:
- Never invent order details, amounts, or timelines; never mention internal systems, policies, or reason codes.
- Say a specialist will follow up ONLY when the outcome says it was sent to a specialist for review. For a completed or declined outcome, do not promise any follow-up.
- For a decline, be polite and explain briefly; do not promise a specific outcome.`;

function outcomeLine(input: ComposeInput): string {
  if (input.decision === "auto_resolved") {
    return `The system completed this automatically: ${input.actionDescription}.`;
  }
  if (input.decision === "escalated") {
    return `This has been sent to a human specialist to review (${input.actionDescription}).`;
  }
  // rejected
  if (input.reasons.includes("NOTHING_REFUNDABLE")) {
    return "Declined: this order has already been fully refunded.";
  }
  if (input.reasons.includes("ALREADY_SHIPPED")) {
    return "Declined: this order has already shipped or been delivered, so it can no longer be cancelled.";
  }
  if (input.reasons.includes("NOT_AUTHORIZED") || input.reasons.includes("ORDER_NOT_FOUND")) {
    return "Declined: we could not find that order on the customer's account.";
  }
  return "Declined: this could not be completed automatically.";
}

export async function composeCustomerMessage(input: ComposeInput): Promise<string | null> {
  const llm = input.llm ?? createGeminiClient();
  const prompt = `Customer wrote: "${input.request}"\n${outcomeLine(input)}\nWrite the reply to the customer now.`;
  try {
    const res = await llm.generate({
      system: SYSTEM,
      contents: [{ role: "user", text: prompt }],
      tools: [],
    });
    const text = res.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null; // caller falls back to a deterministic template
  }
}
