import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { listCustomerOrders } from "@/services/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A customer's own orders — scoped to the authenticated user, never a query param.
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "order.read_own"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = await listCustomerOrders(session.sub);
  return NextResponse.json({ items });
}
