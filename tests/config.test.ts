import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("config validation", () => {
  it("throws on empty env", () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "mysql://x",
        AUTH_SECRET: "x".repeat(16),
      }),
    ).toThrow(/postgres/);
  });

  it("throws when AUTH_SECRET is too short", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://u:p@h:5432/db",
        AUTH_SECRET: "short",
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it("accepts valid env and applies defaults", () => {
    const c = loadConfig({
      DATABASE_URL: "postgres://u:p@h:5432/db",
      AUTH_SECRET: "a".repeat(16),
    });
    expect(c.GEMINI_MODEL).toBe("gemini-flash-latest");
    expect(c.CANCEL_AUTO_WINDOW_HOURS).toBe(24);
    expect(c.REPLACEMENT_WINDOW_DAYS).toBe(30);
    expect(c.AUTO_REFUND_MAX).toBe("50.00");
    expect(c.isProd).toBe(false);
  });

  it("coerces numeric envs and detects production", () => {
    const c = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://u:p@h:5432/db",
      AUTH_SECRET: "a".repeat(16),
      CANCEL_AUTO_WINDOW_HOURS: "48",
    });
    expect(c.CANCEL_AUTO_WINDOW_HOURS).toBe(48);
    expect(c.isProd).toBe(true);
  });
});
