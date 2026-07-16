import { describe, it, expect } from "vitest";
import {
  hasPermission,
  requiredPermissionFor,
  homeForRole,
} from "../src/lib/rbac";

describe("rbac", () => {
  it("grants only a role's own permissions", () => {
    expect(hasPermission("customer", "request.create")).toBe(true);
    expect(hasPermission("customer", "escalation.decide")).toBe(false);
    expect(hasPermission("reviewer", "escalation.decide")).toBe(true);
    expect(hasPermission("reviewer", "request.create")).toBe(false);
    expect(hasPermission("admin", "escalation.decide")).toBe(true);
    expect(hasPermission("admin", "request.create")).toBe(true);
  });

  it("maps routes to required permissions (longest prefix wins)", () => {
    expect(requiredPermissionFor("/console")).toBe("escalation.read");
    expect(requiredPermissionFor("/console/abc-123")).toBe("escalation.read");
    expect(requiredPermissionFor("/portal")).toBe("request.create");
    expect(requiredPermissionFor("/api/escalations/123")).toBe("escalation.read");
    expect(requiredPermissionFor("/api/support-requests")).toBe("request.create");
  });

  it("returns null for unguarded routes", () => {
    expect(requiredPermissionFor("/login")).toBeNull();
    expect(requiredPermissionFor("/api/health")).toBeNull();
    expect(requiredPermissionFor("/")).toBeNull();
  });

  it("routes roles to their home", () => {
    expect(homeForRole("customer")).toBe("/portal");
    expect(homeForRole("reviewer")).toBe("/console");
    expect(homeForRole("admin")).toBe("/console");
  });
});
