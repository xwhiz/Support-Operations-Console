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

  it("grants order permissions per role", () => {
    expect(hasPermission("customer", "order.create")).toBe(true);
    expect(hasPermission("customer", "order.read_own")).toBe(true);
    expect(hasPermission("customer", "order.update_status")).toBe(false);
    expect(hasPermission("reviewer", "order.update_status")).toBe(true);
    expect(hasPermission("reviewer", "order.read_any")).toBe(true);
    expect(hasPermission("reviewer", "order.create")).toBe(false);
    expect(hasPermission("admin", "order.update_status")).toBe(true);
    expect(hasPermission("admin", "order.create")).toBe(true);
  });

  it("maps the new API routes to permissions", () => {
    expect(requiredPermissionFor("/api/my-orders")).toBe("order.read_own");
    expect(requiredPermissionFor("/api/customers")).toBe("order.read_any");
    expect(requiredPermissionFor("/api/portal/overview")).toBe("order.read_own");
    expect(requiredPermissionFor("/api/analytics/overview")).toBe("escalation.read");
  });
});
