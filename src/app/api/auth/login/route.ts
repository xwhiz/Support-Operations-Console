import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth";
import { createSessionCookie } from "@/lib/session-cookie";
import { homeForRole } from "@/lib/rbac";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const session = await authenticate(parsed.data.email, parsed.data.password);
  if (!session) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await createSessionCookie(session);
  return NextResponse.json({
    ok: true,
    name: session.name,
    role: session.role,
    home: homeForRole(session.role),
  });
}
