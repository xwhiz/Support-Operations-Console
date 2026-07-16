import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session-cookie";
import { hasPermission } from "@/lib/rbac";
import { approveEscalation, rejectEscalation } from "@/services/escalations";
import { getEscalationDetail } from "@/services/escalation-reads";
import { ConflictError, NotFoundError, ValidationError } from "@/services/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  expectedVersion: z.number().int(),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasPermission(session.role, "escalation.decide")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const cmd = {
    escalationId: id,
    expectedVersion: parsed.data.expectedVersion,
    reviewerId: session.sub,
    note: parsed.data.note,
  };

  try {
    const esc =
      parsed.data.decision === "approve"
        ? await approveEscalation(cmd)
        : await rejectEscalation(cmd);
    return NextResponse.json({
      ok: true,
      escalation: { id: esc.id, status: esc.status, version: esc.version },
    });
  } catch (e) {
    if (e instanceof ConflictError) {
      // Loser of the race: return the authoritative current state so the UI can
      // show "already decided by X" and disable the stale action. Guard the read
      // so a transient DB error here still yields a clean 409, not a 500.
      let current = null;
      try {
        current = (await getEscalationDetail(id))?.escalation ?? null;
      } catch {
        /* fall back to a bare 409 */
      }
      return NextResponse.json({ error: "conflict", code: e.code, escalation: current }, { status: 409 });
    }
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.code }, { status: 422 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "server_error", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
