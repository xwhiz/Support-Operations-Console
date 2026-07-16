import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { getPortalOverview } from "@/services/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A customer's own overview — scoped to the authenticated user.
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "order.read_own"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const data = await getPortalOverview(session.sub);
  return NextResponse.json(data);
}
