import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { getAnalyticsOverview } from "@/services/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "escalation.read"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const data = await getAnalyticsOverview();
  return NextResponse.json(data);
}
