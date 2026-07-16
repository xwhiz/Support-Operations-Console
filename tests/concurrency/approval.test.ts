import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { and, eq, inArray } from "drizzle-orm";
import { makeTestDb, truncateAll } from "../helpers/db";
import { seedRefundEscalation, insertReviewer } from "../helpers/fixtures";
import { escalations, refunds, executionAttempts } from "../../src/db/schema";
import { approveEscalation, rejectEscalation } from "../../src/services/escalations";
import { ConflictError } from "../../src/services/errors";

describe("escalation decisions — double-approval exactly-once", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;
  let reviewerA: { id: string };
  let reviewerB: { id: string };

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
    reviewerA = await insertReviewer(db);
    reviewerB = await insertReviewer(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("two reviewers approve simultaneously -> one wins, one 409, executes exactly once", async () => {
    const { escalation, order } = await seedRefundEscalation(db, { total: "100.00", amount: "60.00" });

    const results = await Promise.allSettled([
      approveEscalation({ escalationId: escalation.id, expectedVersion: 0, reviewerId: reviewerA.id }, db),
      approveEscalation({ escalationId: escalation.id, expectedVersion: 0, reviewerId: reviewerB.id }, db),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const conflicts = results.filter(
      (r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof ConflictError,
    );
    expect(fulfilled).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    // Escalation transitioned exactly once.
    const [esc] = await db.select().from(escalations).where(eq(escalations.id, escalation.id));
    expect(esc.status).toBe("executed");
    expect(esc.version).toBe(1);
    expect(esc.resultingRefundId).toBeTruthy();

    // Exactly one refund on the order.
    const active = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ["pending", "succeeded"])));
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("succeeded");
  });

  it("approve executes the guarded refund and records the reviewer", async () => {
    const { escalation } = await seedRefundEscalation(db, { total: "100.00", amount: "60.00" });
    const esc = await approveEscalation(
      { escalationId: escalation.id, expectedVersion: 0, reviewerId: reviewerA.id, note: "looks legit" },
      db,
    );
    expect(esc.status).toBe("executed");
    expect(esc.decidedByReviewerId).toBe(reviewerA.id);
    expect(esc.decision).toBe("approve");

    // The human-approval channel is audited in execution_attempts.
    const attempts = await db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.escalationId, escalation.id));
    const executed = attempts.filter(
      (a) => a.initiatedVia === "human_approval" && a.outcome === "executed",
    );
    expect(executed).toHaveLength(1);
  });

  it("reject transitions to rejected without executing", async () => {
    const { escalation, order } = await seedRefundEscalation(db);
    const esc = await rejectEscalation(
      { escalationId: escalation.id, expectedVersion: 0, reviewerId: reviewerB.id, note: "not valid" },
      db,
    );
    expect(esc.status).toBe("rejected");
    const refs = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refs).toHaveLength(0);
  });

  it("a stale expectedVersion is rejected with a conflict", async () => {
    const { escalation } = await seedRefundEscalation(db);
    await expect(
      approveEscalation({ escalationId: escalation.id, expectedVersion: 5, reviewerId: reviewerA.id }, db),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("deciding an already-decided escalation conflicts", async () => {
    const { escalation } = await seedRefundEscalation(db);
    await approveEscalation({ escalationId: escalation.id, expectedVersion: 0, reviewerId: reviewerA.id }, db);
    await expect(
      rejectEscalation({ escalationId: escalation.id, expectedVersion: 1, reviewerId: reviewerB.id }, db),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
