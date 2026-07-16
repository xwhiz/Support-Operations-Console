/**
 * DEV-ONLY harness to fire N concurrent executor calls at one order and observe
 * the outcome (used to demonstrate double-refund protection locally). Returns
 * 404 in production. In real use, mutations happen via the agent (V4) or a
 * reviewer approval (V5), never this endpoint.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { config } from "@/config";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import {
  executeRefund,
  executeCancellation,
  executeReplacement,
} from "@/services/guarded-executor";
import { GuardrailError, ConflictError } from "@/services/errors";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["refund", "cancellation", "replacement"]),
  orderNumber: z.number().int(),
  amount: z.string().optional(),
  count: z.number().int().min(1).max(50).default(1),
  requesterCustomerId: z.string().optional(),
});

export async function POST(req: Request) {
  if (config.isProd) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { action, orderNumber, amount, count, requesterCustomerId } = parsed.data;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  const runOne = () => {
    const ctx = {
      actor: "system",
      initiatedVia: "auto" as const,
      requesterCustomerId,
    };
    const idempotencyKey = `dev:${action}:${order.id}:${randomUUID()}`;
    if (action === "refund") {
      return executeRefund({ ...ctx, orderId: order.id, amount: amount ?? "0", idempotencyKey });
    }
    if (action === "cancellation") {
      return executeCancellation({ ...ctx, orderId: order.id, idempotencyKey });
    }
    return executeReplacement({ ...ctx, orderId: order.id, idempotencyKey });
  };

  const results = await Promise.allSettled(Array.from({ length: count }, runOne));
  const summary = { executed: 0, conflict: 0, guardrail: 0, error: 0 };
  const detail = results.map((r) => {
    if (r.status === "fulfilled") {
      summary.executed++;
      return { ok: true, id: (r.value as { id: string }).id };
    }
    const e = r.reason;
    if (e instanceof ConflictError) {
      summary.conflict++;
      return { ok: false, kind: "conflict", code: e.code };
    }
    if (e instanceof GuardrailError) {
      summary.guardrail++;
      return { ok: false, kind: "guardrail", code: e.code };
    }
    summary.error++;
    return { ok: false, kind: "error", message: e instanceof Error ? e.message : String(e) };
  });

  return NextResponse.json({
    order: { number: orderNumber, id: order.id },
    count,
    summary,
    detail,
  });
}
