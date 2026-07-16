import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { eq } from "drizzle-orm";
import { makeTestDb, truncateAll } from "../helpers/db";
import { seedPaidOrder } from "../helpers/fixtures";
import { proposedActions, agentMessages } from "../../src/db/schema";
import { handleSupportRequest } from "../../src/services/intake";

/**
 * Live end-to-end check against the real Gemini API. Runs only when
 * GEMINI_API_KEY is set; validates the SDK wiring, tool schemas, and the full
 * agent -> policy -> execution path with a real model (not a mock).
 */
const hasKey = Boolean(process.env.GEMINI_API_KEY);

describe.runIf(hasKey)("live Gemini smoke", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it(
    "processes a real refund request end-to-end",
    async () => {
      const { customer, order } = await seedPaidOrder(db, { total: "40.00" });
      let res;
      try {
        res = await handleSupportRequest({
          requesterCustomerId: customer.id,
          rawText: `I want a refund for order ${order.orderNumber}.`,
          dbc: db,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
          console.warn("live-smoke skipped: Gemini free-tier rate limit hit");
          return; // environmental limit, not a code failure
        }
        throw e;
      }

      expect(["auto_resolved", "escalated", "rejected"]).toContain(res.decision);
      expect(res.finalMessage.length).toBeGreaterThan(0);

      const [pa] = await db
        .select()
        .from(proposedActions)
        .where(eq(proposedActions.agentRunId, res.agentRunId));
      expect(pa).toBeTruthy();
      expect(pa.policyMode).toBeTruthy();

      const msgs = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentRunId, res.agentRunId));
      expect(msgs.length).toBeGreaterThan(1); // at least the user turn + one model turn
    },
    60_000,
  );
});
