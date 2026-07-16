import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { updateOrderStatus, type OrderStatus } from "@/services/orders";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/services/errors";
import { orderStatusEnum } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  status: z.enum(orderStatusEnum.enumValues as unknown as [string, ...string[]]),
  expectedVersion: z.number().int().min(0),
});

// Reviewer advances an order's status (version CAS + payment linkage on paid).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "order.update_status"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const order = await updateOrderStatus({
      orderId: id,
      targetStatus: body.status as OrderStatus,
      expectedVersion: body.expectedVersion,
      reviewerId: session.sub,
    });
    return NextResponse.json({
      ok: true,
      order: { id: order.id, status: order.status, version: order.version },
    });
  } catch (e) {
    if (e instanceof ValidationError)
      return NextResponse.json({ error: e.code }, { status: 422 });
    if (e instanceof ConflictError)
      return NextResponse.json(
        { error: e.code, current: e.current },
        { status: 409 },
      );
    if (e instanceof NotFoundError)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.error("updateOrderStatus failed", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
