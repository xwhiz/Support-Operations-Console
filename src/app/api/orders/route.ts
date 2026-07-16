import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import {
  createOrder,
  listAllOrders,
  type OrderStatus,
} from "@/services/orders";
import { ValidationError } from "@/services/errors";
import { orderStatusEnum } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1),
});

// Customer creates an order. Auth enforced per-method (this path serves two roles).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "order.create"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const result = await createOrder({
      customerId: session.sub,
      items: body.items,
    });
    return NextResponse.json(
      { order: result.order, items: result.items },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ValidationError)
      return NextResponse.json({ error: e.code }, { status: 422 });
    console.error("createOrder failed", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// Reviewer lists all orders (optionally filtered by status) + KPIs.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "order.read_any"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const statusParam = new URL(req.url).searchParams.get("status");
  const status =
    statusParam &&
    (orderStatusEnum.enumValues as readonly string[]).includes(statusParam)
      ? (statusParam as OrderStatus)
      : undefined;

  const data = await listAllOrders({ status });
  return NextResponse.json(data);
}
