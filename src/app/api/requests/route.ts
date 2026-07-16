import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { listQueue } from "@/services/escalation-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Filter = "pending" | "approved" | "rejected" | "auto_resolved" | "all";

type Item = {
  escalationStatus: string | null;
  requestStatus: string;
};

const isPending = (i: Item) => i.escalationStatus === "pending";
const isApproved = (i: Item) =>
  i.escalationStatus === "approved" || i.escalationStatus === "executed";
const isRejected = (i: Item) => i.escalationStatus === "rejected";
const isAuto = (i: Item) => i.requestStatus === "auto_resolved";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "escalation.read"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("filter") ?? "pending";
  const filter: Filter = (
    raw === "needs_review" ? "pending" : raw
  ) as Filter;

  // One read of all activity; bucket + count in memory (dataset is small).
  const items = (await listQueue("all")) as unknown as Item[];

  const kpis = {
    total: items.length,
    pending: items.filter(isPending).length,
    approved: items.filter(isApproved).length,
    rejected: items.filter(isRejected).length,
    auto_resolved: items.filter(isAuto).length,
  };

  const predicate: Record<Filter, (i: Item) => boolean> = {
    pending: isPending,
    approved: isApproved,
    rejected: isRejected,
    auto_resolved: isAuto,
    all: () => true,
  };
  const pick = predicate[filter] ?? isPending;
  const filtered = filter === "all" ? items : items.filter(pick);

  return NextResponse.json({ items: filtered, kpis });
}
