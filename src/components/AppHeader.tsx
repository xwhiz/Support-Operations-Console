import type { SessionPayload } from "@/lib/session";
import { LogoutButton } from "./LogoutButton";

export function AppHeader({
  session,
  area,
}: {
  session: SessionPayload;
  area: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
          Support Operations Console
        </span>
        <span className="text-xs uppercase tracking-wide text-neutral-500">
          {area}
        </span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-neutral-600 dark:text-neutral-300">
          {session.name ?? session.email}
          <span className="ml-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {session.role}
          </span>
        </span>
        <LogoutButton />
      </div>
    </header>
  );
}
