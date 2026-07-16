/**
 * The manual tool-calling agent loop. The LLM decides which tools to call; we
 * execute them, persist the full trace (agent_runs / agent_messages / tool_calls
 * / proposed_actions), and stop when the model stops requesting tools. No DB
 * transaction is held across an LLM call. Policy + execution happen afterwards
 * in the intake service — the loop only produces intent + trace.
 */
import { eq } from "drizzle-orm";
import { db as appDb, type DB } from "../db/client";
import {
  supportRequests,
  agentRuns,
  agentMessages,
  toolCalls,
  proposedActions,
} from "../db/schema";
import { config } from "../config";
import { createGeminiClient, type LlmClient, type NeutralContent } from "./llm";
import { TOOL_DEFS, executeTool, type ToolContext } from "./tools";

const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are a support-triage agent for an e-commerce store. You handle only refunds, order cancellations, and replacements for damaged items.

Rules:
- The customer is already authenticated; you can only see and act on their own orders.
- ALWAYS call getOrder (and getCustomerOrders if the order number is unclear) to retrieve the facts BEFORE proposing anything.
- You CANNOT execute actions. You may only PROPOSE (proposeRefund / proposeCancellation / proposeReplacement) or escalate. The system separately validates every proposal and either auto-executes it or routes it to a human reviewer.
- Be conservative: an incorrect refund or cancellation is far worse than escalating. When the request is ambiguous, out of scope, references an order you cannot see, or you are unsure, call escalate.
- Damaged/defective items: use proposeReplacement (these always go to a human).
- Never refund more than was paid; never promise an outcome for something that will be reviewed by a human.

Finish every request by calling exactly ONE of: proposeRefund, proposeCancellation, proposeReplacement, or escalate. After that, write a short, friendly message to the customer explaining what happens next (for escalations, say a support specialist will review it shortly).`;

export type AgentRunResult = {
  supportRequestId: string;
  agentRunId: string;
  proposal: typeof proposedActions.$inferSelect;
  finalMessage: string;
  stopReason: string;
  iterations: number;
};

export async function runAgent(params: {
  requesterCustomerId: string;
  rawText: string;
  channel?: string;
  referencedOrderNumber?: number | null;
  llm?: LlmClient;
  dbc?: DB;
}): Promise<AgentRunResult> {
  const dbc = params.dbc ?? appDb;
  const llm = params.llm ?? createGeminiClient();

  const [request] = await dbc
    .insert(supportRequests)
    .values({
      requesterCustomerId: params.requesterCustomerId,
      rawText: params.rawText,
      channel: params.channel ?? "chat",
      referencedOrderNumber: params.referencedOrderNumber ?? null,
      status: "processing",
    })
    .returning();

  const [run] = await dbc
    .insert(agentRuns)
    .values({ supportRequestId: request.id, model: config.GEMINI_MODEL, status: "running" })
    .returning();

  const ctx: ToolContext = {
    requesterCustomerId: params.requesterCustomerId,
    agentRunId: run.id,
    supportRequestId: request.id,
    dbc,
  };

  const contents: NeutralContent[] = [{ role: "user", text: params.rawText }];
  let msgSeq = 0;
  let toolSeq = 0;
  let terminalProposal: typeof proposedActions.$inferSelect | null = null;
  let finalMessage = "";
  let stopReason = "end_turn";
  let inputTokens = 0;
  let outputTokens = 0;
  let iterations = 0;

  await dbc.insert(agentMessages).values({
    agentRunId: run.id,
    seq: msgSeq++,
    role: "user",
    content: { text: params.rawText },
  });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterations = i + 1;
      const res = await llm.generate({ system: SYSTEM_PROMPT, contents, tools: TOOL_DEFS });
      inputTokens += res.usage.input ?? 0;
      outputTokens += res.usage.output ?? 0;

      await dbc.insert(agentMessages).values({
        agentRunId: run.id,
        seq: msgSeq++,
        role: "assistant",
        content: { text: res.text, toolCalls: res.toolCalls },
      });

      if (res.toolCalls.length === 0) {
        finalMessage = res.text;
        stopReason = "end_turn";
        break;
      }

      contents.push({ role: "model", text: res.text || undefined, toolCalls: res.toolCalls });

      const responses: { id?: string; name: string; response: Record<string, unknown> }[] = [];
      for (const call of res.toolCalls) {
        const toolUseId = call.id ?? `${call.name}-${toolSeq}`;
        const result = await executeTool(call.name, call.args, ctx);
        await dbc.insert(toolCalls).values({
          agentRunId: run.id,
          seq: toolSeq++,
          toolName: call.name,
          toolUseId,
          input: call.args,
          output: result.response,
          isError: result.isError,
          endedAt: new Date(),
        });
        if (result.proposal) terminalProposal = result.proposal;
        responses.push({ id: call.id, name: call.name, response: result.response });
      }
      contents.push({ role: "tool", responses });

      // A proposal (or escalation) is the terminal intent — stop here rather than
      // spending another LLM round-trip on a final message. The customer-facing
      // message is generated deterministically by the intake service.
      if (terminalProposal) {
        stopReason = "proposed";
        break;
      }
      if (i === MAX_ITERATIONS - 1) stopReason = "max_iterations";
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await dbc
      .update(agentRuns)
      .set({ status: "failed", error: message, endedAt: new Date(), iterations, inputTokens, outputTokens })
      .where(eq(agentRuns.id, run.id));
    await dbc
      .update(supportRequests)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(supportRequests.id, request.id));
    throw e;
  }

  // No proposal produced (ran out of turns, or model only chatted) -> fail toward
  // the human with an explicit no_action proposal.
  if (!terminalProposal) {
    const [row] = await dbc
      .insert(proposedActions)
      .values({
        agentRunId: run.id,
        supportRequestId: request.id,
        actionType: "no_action",
        payload: { type: "no_action" },
      })
      .returning();
    terminalProposal = row;
  }

  if (!finalMessage) {
    finalMessage = "Thanks — I've passed this to our support team for review.";
  }

  await dbc
    .update(agentRuns)
    .set({ status: "completed", stopReason, iterations, inputTokens, outputTokens, finalMessage, endedAt: new Date() })
    .where(eq(agentRuns.id, run.id));

  return {
    supportRequestId: request.id,
    agentRunId: run.id,
    proposal: terminalProposal,
    finalMessage,
    stopReason,
    iterations,
  };
}
