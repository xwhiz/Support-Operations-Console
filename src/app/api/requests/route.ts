import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { listQueue } from "@/services/escalation-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "escalation.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const filter = new URL(req.url).searchParams.get("filter") === "all" ? "all" : "needs_review";
  const items = await listQueue(filter);
  return NextResponse.json({ items });
}
