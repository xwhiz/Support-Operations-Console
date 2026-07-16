import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/lib/session";

describe("session jwt", () => {
  it("round-trips a valid session", async () => {
    const token = await signSession({
      sub: "u1",
      email: "a@b.c",
      name: "A",
      role: "reviewer",
    });
    const s = await verifySession(token);
    expect(s?.sub).toBe("u1");
    expect(s?.email).toBe("a@b.c");
    expect(s?.role).toBe("reviewer");
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({
      sub: "u1",
      email: "a@b.c",
      name: "A",
      role: "customer",
    });
    const tampered = token.slice(0, -3) + "AAA";
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySession("not.a.jwt")).toBeNull();
    expect(await verifySession("")).toBeNull();
  });
});
