/**
 * Route guard. Runs on the Edge runtime, so it only verifies the JWT (jose) and
 * checks the route's required permission from the code map — no pg, no bcrypt.
 * Pages redirect; API routes get JSON 401/403. Route handlers still re-check
 * fine-grained permissions themselves (defense in depth).
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/session";
import { requiredPermissionFor, hasPermission, homeForRole } from "./lib/rbac";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const required = requiredPermissionFor(pathname);
  if (!required) return NextResponse.next();

  const isApi = pathname.startsWith("/api");
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    if (isApi)
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!hasPermission(session.role, required)) {
    if (isApi)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL(homeForRole(session.role), req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/portal/:path*",
    "/console/:path*",
    "/api/support-requests/:path*",
    "/api/escalations/:path*",
  ],
};
