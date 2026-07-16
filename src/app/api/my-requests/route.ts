import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { listCustomerRequests } from "@/services/escalation-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "request.read_own")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Scoped to the authenticated customer — never a query param.
  const items = await listCustomerRequests(session.sub);
  return NextResponse.json({ items });
}
