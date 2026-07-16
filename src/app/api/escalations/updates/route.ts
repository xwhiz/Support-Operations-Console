import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { waitForEscalationChange } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Long-poll: resolves when an escalation changes, or after a ~25s timeout.
 *  The client refetches and immediately reconnects on either outcome. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "escalation.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // A listener bootstrap failure shouldn't 500 the client's poll loop — return a
  // benign "no change" so it simply reconnects (the listener self-heals).
  try {
    const payload = await waitForEscalationChange(25_000);
    return NextResponse.json({ changed: payload !== null });
  } catch {
    return NextResponse.json({ changed: false }, { status: 200 });
  }
}
