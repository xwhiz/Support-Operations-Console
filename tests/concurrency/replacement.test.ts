import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { makeTestDb, truncateAll } from "../helpers/db";
import { seedPaidOrder, daysAgo } from "../helpers/fixtures";
import { replacements } from "../../src/db/schema";
import {
  executeReplacement,
  type ReplacementCommand,
} from "../../src/services/guarded-executor";
import { ConflictError } from "../../src/services/errors";

describe("guarded executor — replacement", () => {
  let db: ReturnType<typeof makeTestDb>["db"];
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = makeTestDb());
    await truncateAll(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  function cmd(orderId: string, over: Partial<ReplacementCommand> = {}): ReplacementCommand {
    return {
      actor: "reviewer:test",
      initiatedVia: "human_approval",
      orderId,
      idempotencyKey: `k-${randomUUID()}`,
      ...over,
    };
  }

  it("DOUBLE-REPLACEMENT: N concurrent -> exactly one succeeds, rest 409, one row", async () => {
    const { order } = await seedPaidOrder(db, { status: "delivered", deliveredAt: daysAgo(3) });
    const N = 6;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => executeReplacement(cmd(order.id), db)),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const conflicts = results.filter(
      (r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof ConflictError,
    );
    expect(fulfilled).toHaveLength(1);
    expect(conflicts).toHaveLength(N - 1);

    const active = await db
      .select()
      .from(replacements)
      .where(and(eq(replacements.orderId, order.id), inArray(replacements.status, ["pending", "succeeded"])));
    expect(active).toHaveLength(1);
  });

  it("rejects a replacement on a not-yet-delivered order (NOT_DELIVERED)", async () => {
    const { order } = await seedPaidOrder(db, { status: "paid", deliveredAt: null });
    await expect(executeReplacement(cmd(order.id), db)).rejects.toMatchObject({
      code: "NOT_DELIVERED",
    });
  });

  it("rejects a replacement outside the window (OUTSIDE_REPLACEMENT_WINDOW)", async () => {
    const { order } = await seedPaidOrder(db, { status: "delivered", deliveredAt: daysAgo(60) });
    await expect(executeReplacement(cmd(order.id), db)).rejects.toMatchObject({
      code: "OUTSIDE_REPLACEMENT_WINDOW",
    });
  });
});
