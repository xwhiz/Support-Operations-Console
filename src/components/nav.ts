import {
  LayoutDashboard,
  ShoppingBag,
  Inbox,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/rbac";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Active only on an exact path match (used for section roots). */
  exact?: boolean;
};

export const CUSTOMER_NAV: NavItem[] = [
  { label: "Dashboard", href: "/portal", icon: LayoutDashboard, exact: true },
  { label: "Orders", href: "/portal/orders", icon: ShoppingBag },
  { label: "Requests", href: "/portal/requests", icon: Inbox },
];

export const REVIEWER_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console", icon: LayoutDashboard, exact: true },
  { label: "Requests", href: "/console/requests", icon: Inbox },
  { label: "Orders", href: "/console/orders", icon: ShoppingBag },
  { label: "Customers", href: "/console/customers", icon: Users },
];

export function navForRole(role: Role): NavItem[] {
  return role === "customer" ? CUSTOMER_NAV : REVIEWER_NAV;
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
