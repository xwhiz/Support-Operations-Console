"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Headset, LogOut, Menu, X } from "lucide-react";
import type { SessionPayload } from "@/lib/session";
import { navForRole, isActive } from "./nav";
import { Avatar } from "./ui/Avatar";
import { cn } from "@/lib/cn";

function Brand({ area }: { area: string }) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-400 text-gray-900 shadow-xs">
        <Headset className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-gray-900">SupportOps</p>
        <p className="text-[11px] font-medium text-gray-500">{area}</p>
      </div>
    </div>
  );
}

export function AppShell({
  session,
  area,
  children,
}: {
  session: SessionPayload;
  area: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const nav = navForRole(session.role);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const navList = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {nav.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-brand-400 text-gray-900"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
            )}
          >
            <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const userCard = (
    <div className="border-t border-gray-200 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <Avatar name={session.name || session.email} seed={session.sub} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">
            {session.name || session.email}
          </p>
          <p className="truncate text-xs text-gray-500 capitalize">
            {session.role}
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          aria-label="Sign out"
          title="Sign out"
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-gray-200 bg-gradient-to-b from-gray-50 via-gray-50 to-brand-50/40 lg:flex">
        <div className="flex h-16 items-center">
          <Brand area={area} />
        </div>
        <div className="mt-2 flex flex-1 flex-col overflow-y-auto pb-2">
          {navList}
        </div>
        {userCard}
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
        <Brand area={area} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-gray-950/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-gray-200 bg-gray-50">
            <div className="flex h-16 items-center justify-between pr-3">
              <Brand area={area} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-2 flex flex-1 flex-col overflow-y-auto pb-2">
              {navList}
            </div>
            {userCard}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="lg:pl-[272px]">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
