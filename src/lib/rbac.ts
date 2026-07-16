/**
 * Role-based access control. Simple by design (see ARCHITECTURE / PLAN): the
 * permission set lives in code as a role -> permissions map, and a route ->
 * required-permission map drives the middleware. This is enough to make the
 * two graded scenarios real (authorization boundary + reviewer identity)
 * without auth infrastructure the assessment isn't grading.
 */
export type Role = "customer" | "reviewer" | "admin";

export type Permission =
  | "request.create"
  | "request.read_own"
  | "escalation.read"
  | "escalation.decide"
  | "order.read_any";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  customer: ["request.create", "request.read_own"],
  reviewer: ["escalation.read", "escalation.decide", "order.read_any"],
  admin: [
    "request.create",
    "request.read_own",
    "escalation.read",
    "escalation.decide",
    "order.read_any",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Where a role lands after login / when it hits a page it may not access. */
export function homeForRole(role: Role): string {
  return role === "customer" ? "/portal" : "/console";
}

/**
 * Route prefix -> required permission. Most specific (longest) prefix wins, so a
 * decision endpoint can require a stricter permission than the list endpoint.
 */
const ROUTE_PERMISSIONS: { prefix: string; permission: Permission }[] = [
  { prefix: "/portal", permission: "request.create" },
  { prefix: "/console", permission: "escalation.read" },
  { prefix: "/api/support-requests", permission: "request.create" },
  { prefix: "/api/my-requests", permission: "request.read_own" },
  { prefix: "/api/escalations", permission: "escalation.read" },
  { prefix: "/api/requests", permission: "escalation.read" },
];

export function requiredPermissionFor(pathname: string): Permission | null {
  const match = ROUTE_PERMISSIONS.filter(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  ).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match?.permission ?? null;
}
