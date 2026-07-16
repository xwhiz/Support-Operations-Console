import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { handleSupportRequest } from "@/services/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The agent loop makes several LLM round-trips; allow generous time (Railway has no
// request-duration cap on the private network; this hint helps other hosts too).
export const maxDuration = 120;

const Body = z.object({ message: z.string().min(1).max(4000) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "request.create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await handleSupportRequest({
      requesterCustomerId: session.sub,
      rawText: parsed.data.message,
      channel: "chat",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "agent_error", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
