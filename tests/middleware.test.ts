import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { signSession, SESSION_COOKIE } from "../src/lib/session";

function reqFor(path: string, token?: string) {
  const headers = new Headers();
  if (token) headers.set("cookie", `${SESSION_COOKIE}=${token}`);
  return new NextRequest(new URL(`http://localhost${path}`), { headers });
}

describe("middleware route guard", () => {
  it("redirects an unauthenticated page request to /login", async () => {
    const res = await middleware(reqFor("/console"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("returns 401 JSON for an unauthenticated API request", async () => {
    const res = await middleware(reqFor("/api/escalations"));
    expect(res.status).toBe(401);
  });

  it("redirects a customer away from the reviewer console to their home", async () => {
    const token = await signSession({ sub: "c", email: "c@x", name: "C", role: "customer" });
    const res = await middleware(reqFor("/console", token));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/portal");
  });

  it("returns 403 JSON when a customer hits a reviewer API", async () => {
    const token = await signSession({ sub: "c", email: "c@x", name: "C", role: "customer" });
    const res = await middleware(reqFor("/api/escalations", token));
    expect(res.status).toBe(403);
  });

  it("allows a reviewer into the console (no redirect)", async () => {
    const token = await signSession({ sub: "r", email: "r@x", name: "R", role: "reviewer" });
    const res = await middleware(reqFor("/console", token));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("ignores unguarded routes", async () => {
    const res = await middleware(reqFor("/login"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });
});
